/**
 * The only module that talks to Canvas.
 *
 * Read-only is enforced structurally: this class exposes exactly one request
 * primitive, it hardcodes `method: 'GET'`, and no caller anywhere can pass a
 * method through. There is no post/put/delete to accidentally reach for.
 */

import {
    REMEMBER_COOKIE_NAME,
    cookieSetupSteps,
    isBundleInstall,
    loadConfig,
    readEnvFile,
    type CanvasConfig,
} from '../config.js';

/** Stop following `rel="next"` past this, so a bad query can't spin forever. */
const MAX_PAGES = 20;
const PER_PAGE = 100;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;

/**
 * Auth failed — almost always an expired cookie. Carries the fix, not a stack
 * trace, because this is the error you will actually see most often.
 */
export class CanvasAuthError extends Error {
    constructor(detail: string) {
        super(detail);
        this.name = 'CanvasAuthError';
    }
}

/** Any non-auth failure from Canvas (404, 5xx, network, timeout). */
export class CanvasRequestError extends Error {
    constructor(
        message: string,
        readonly status?: number,
    ) {
        super(message);
        this.name = 'CanvasRequestError';
    }
}

/**
 * Names the actual cookie this install uses, because the whole failure mode this
 * message addresses is looking at the wrong cookie in DevTools.
 */
export function reauthInstructions(cookieName: string): string {
    return [
        'Canvas rejected the credentials — your session cookie has almost certainly expired.',
        '',
        'To refresh it:',
        cookieSetupSteps(cookieName),
        '',
        ...(isBundleInstall()
            ? []
            : [
                  'Tip: checking "Stay signed in" at login also yields a `pseudonym_credentials`',
                  'cookie lasting ~2 weeks; set it as CANVAS_REMEMBER_COOKIE to refresh far less',
                  "often. Single sign-on logins (UBC's CWL among them) never offer that box.",
              ]),
    ].join('\n');
}

interface CacheEntry {
    expiresAt: number;
    value: unknown;
}

export interface QueryParams {
    [key: string]: string | number | boolean | undefined | null | Array<string | number>;
}

export class CanvasClient {
    private config: CanvasConfig;
    /**
     * Live session value. Starts from config but Canvas rotates it — when it
     * re-establishes a session from the remember-me cookie it hands back a fresh
     * session cookie in Set-Cookie. Tracking that keeps a long-running server
     * alive instead of dying an hour in.
     */
    private sessionCookie: string;
    private readonly cache = new Map<string, CacheEntry>();

    constructor(config: CanvasConfig) {
        this.config = config;
        this.sessionCookie = config.sessionCookie;
    }

    /**
     * Re-reads `.env` and adopts a newly pasted credential.
     *
     * Returns true only when the credential actually changed, so an auth failure
     * retries at most once and only when retrying could plausibly help. On an
     * SSO-backed Canvas the cookie expires daily and cannot be extended, so this
     * is what removes "restart the server" from the refresh ritual.
     */
    private reloadCredentials(): boolean {
        let next: CanvasConfig;
        try {
            next = loadConfig({ ...process.env, ...readEnvFile() });
        } catch {
            return false; // .env missing or unparseable; keep what we have
        }
        const changed =
            next.sessionCookie !== this.sessionCookie ||
            next.accessToken !== this.config.accessToken ||
            next.rememberCookie !== this.config.rememberCookie ||
            next.extraCookies !== this.config.extraCookies;
        if (!changed) return false;

        this.config = next;
        this.sessionCookie = next.sessionCookie;
        // Cached responses were produced under the old identity.
        this.cache.clear();
        return true;
    }

    get baseUrl(): string {
        return this.config.baseUrl;
    }

    get icsFeedUrl(): string {
        return this.config.icsFeedUrl;
    }

    /** Which credential is in play — surfaced by the diagnostics tool. */
    get authMode(): 'access token' | 'session cookie' {
        return this.config.accessToken ? 'access token' : 'session cookie';
    }

    /** The session cookie name this install uses. */
    get sessionCookieName(): string {
        return this.config.sessionCookieName;
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            Accept: 'application/json+canvas-string-ids, application/json',
            'User-Agent': this.config.userAgent,
        };

        if (this.config.accessToken) {
            headers['Authorization'] = `Bearer ${this.config.accessToken}`;
            return headers;
        }

        const cookies: string[] = [];
        if (this.sessionCookie) {
            cookies.push(`${this.config.sessionCookieName}=${this.sessionCookie}`);
        }
        if (this.config.rememberCookie) {
            cookies.push(`${REMEMBER_COOKIE_NAME}=${this.config.rememberCookie}`);
        }
        // e.g. cf_clearance for a Canvas behind Cloudflare.
        if (this.config.extraCookies) cookies.push(this.config.extraCookies);
        headers['Cookie'] = cookies.join('; ');
        return headers;
    }

    /** Pick up a rotated session cookie so the process keeps working. */
    private captureRotatedCookie(response: Response): void {
        const setCookie = response.headers.getSetCookie?.() ?? [];
        const prefix = `${this.config.sessionCookieName}=`;
        for (const raw of setCookie) {
            if (!raw.startsWith(prefix)) continue;
            const value = raw.slice(prefix.length).split(';')[0];
            if (value && value !== this.sessionCookie) {
                this.sessionCookie = value;
            }
        }
    }

    private buildUrl(path: string, params?: QueryParams): string {
        const url = new URL(path.startsWith('http') ? path : `${this.config.baseUrl}${path}`);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value === undefined || value === null || value === '') continue;
                if (Array.isArray(value)) {
                    // Canvas expects repeated `key[]=` params for array values.
                    const arrayKey = key.endsWith('[]') ? key : `${key}[]`;
                    for (const item of value) url.searchParams.append(arrayKey, String(item));
                } else {
                    url.searchParams.set(key, String(value));
                }
            }
        }
        return url.toString();
    }

    /**
     * Canvas signals a dead cookie by redirecting to the login page and serving
     * HTML, not by returning a clean 401 — so content type is part of the check.
     */
    private static looksLikeLoginPage(contentType: string, body: string): boolean {
        if (!contentType.includes('text/html')) return false;
        return /login|sign in|password/i.test(body.slice(0, 4000));
    }

    /**
     * Canvas has historically prefixed browser-authenticated JSON with `while(1);`
     * as an anti-JSON-hijacking measure. Cheap to defend against, baffling if it
     * ever fires and we don't.
     */
    private static parseJson(body: string, url: string): unknown {
        const cleaned = body.replace(/^\s*while\s*\(1\)\s*;?/, '');
        try {
            return JSON.parse(cleaned);
        } catch {
            throw new CanvasRequestError(
                `Canvas returned a non-JSON response for ${url}. First 200 chars: ${cleaned.slice(0, 200)}`,
            );
        }
    }

    private static parseNextLink(linkHeader: string | null): string | undefined {
        if (!linkHeader) return undefined;
        for (const part of linkHeader.split(',')) {
            const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
            if (match?.[1]) return match[1];
        }
        return undefined;
    }

    /** Single GET with timeout and retry. Returns the raw Response. */
    private async fetchOnce(url: string): Promise<Response> {
        let lastError: Error | undefined;
        /** Guards the one credential-reload retry, so a dead cookie can't loop. */
        let reloadTried = false;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
            try {
                const response = await fetch(url, {
                    method: 'GET', // read-only, always
                    headers: this.buildHeaders(),
                    redirect: 'follow',
                    signal: controller.signal,
                });
                this.captureRotatedCookie(response);

                if (response.status === 401) {
                    // You may have pasted a fresh cookie into .env since this
                    // process started. Adopt it and retry, without a restart.
                    if (!reloadTried && this.reloadCredentials()) {
                        reloadTried = true;
                        attempt--; // the reload, not the network, gets this try
                        continue;
                    }
                    throw new CanvasAuthError(reauthInstructions(this.config.sessionCookieName));
                }

                // Canvas reports rate limiting as a 403 with a distinctive body.
                if (response.status === 403) {
                    const body = await response.clone().text();
                    if (/rate limit/i.test(body)) {
                        lastError = new CanvasRequestError('Canvas rate limit exceeded', 403);
                        await CanvasClient.backoff(attempt);
                        continue;
                    }
                    throw new CanvasRequestError(
                        `Canvas denied access (403) for ${url}. You may not have permission to read this.`,
                        403,
                    );
                }

                if (response.status === 429 || response.status >= 500) {
                    lastError = new CanvasRequestError(
                        `Canvas returned ${response.status} for ${url}`,
                        response.status,
                    );
                    await CanvasClient.backoff(attempt);
                    continue;
                }

                return response;
            } catch (err) {
                // Auth failures are terminal — retrying a dead cookie is pointless.
                if (err instanceof CanvasAuthError) throw err;
                if (err instanceof CanvasRequestError && err.status === 403) throw err;
                lastError = err instanceof Error ? err : new Error(String(err));
                if (attempt < MAX_ATTEMPTS) await CanvasClient.backoff(attempt);
            } finally {
                clearTimeout(timer);
            }
        }

        throw new CanvasRequestError(
            `Request to ${url} failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? 'unknown error'}`,
        );
    }

    private static backoff(attempt: number): Promise<void> {
        const delay = 500 * 2 ** (attempt - 1);
        return new Promise((resolve) => setTimeout(resolve, delay));
    }

    private async readBody(response: Response, url: string): Promise<unknown> {
        const contentType = response.headers.get('content-type') ?? '';
        const body = await response.text();

        if (CanvasClient.looksLikeLoginPage(contentType, body)) {
            throw new CanvasAuthError(reauthInstructions(this.config.sessionCookieName));
        }
        if (!response.ok) {
            throw new CanvasRequestError(
                `Canvas returned ${response.status} for ${url}: ${body.slice(0, 200)}`,
                response.status,
            );
        }
        return CanvasClient.parseJson(body, url);
    }

    /**
     * Runs an operation and, if it fails authentication, adopts a freshly pasted
     * credential from `.env` and tries once more.
     *
     * `fetchOnce` already does this for a 401; this also covers the login-page
     * redirect some SSO-fronted installs serve instead, which is only detectable
     * after the body is read.
     */
    private async withCredentialReload<T>(run: () => Promise<T>): Promise<T> {
        try {
            return await run();
        } catch (err) {
            if (err instanceof CanvasAuthError && this.reloadCredentials()) {
                return await run();
            }
            throw err;
        }
    }

    /** GET a single JSON object. */
    async get<T>(path: string, params?: QueryParams): Promise<T> {
        const url = this.buildUrl(path, params);
        return this.withCredentialReload(async () => {
            const response = await this.fetchOnce(url);
            return (await this.readBody(response, url)) as T;
        });
    }

    /** GET a paginated collection, following `rel="next"` to the end. */
    async getAll<T>(path: string, params?: QueryParams): Promise<T[]> {
        const firstUrl = this.buildUrl(path, { per_page: PER_PAGE, ...params });

        // The whole pagination walk is the retried unit: a credential swap
        // partway through would otherwise splice two identities' pages together.
        return this.withCredentialReload(async () => {
            let url = firstUrl;
            const results: T[] = [];

            for (let page = 0; page < MAX_PAGES; page++) {
                const response = await this.fetchOnce(url);
                const nextUrl = CanvasClient.parseNextLink(response.headers.get('link'));
                const body = await this.readBody(response, url);

                if (Array.isArray(body)) {
                    results.push(...(body as T[]));
                } else if (body && typeof body === 'object') {
                    // A few Canvas endpoints wrap the list in a single-key object.
                    const values = Object.values(body as Record<string, unknown>);
                    const firstArray = values.find((v): v is T[] => Array.isArray(v));
                    if (firstArray) results.push(...firstArray);
                }

                if (!nextUrl) break;
                url = nextUrl;
            }

            return results;
        });
    }

    /**
     * Cached variant. The stdio server is long-lived, so an in-memory TTL cache
     * keeps request volume low across the several tools that need the same course
     * list — and makes get_daily_briefing cheap.
     */
    async cached<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<T> {
        const hit = this.cache.get(key);
        if (hit && hit.expiresAt > Date.now()) {
            return hit.value as T;
        }
        const value = await produce();
        this.cache.set(key, { expiresAt: Date.now() + ttlMs, value });
        return value;
    }

    /** Fetch the token-free ICS calendar feed as raw text. */
    async fetchIcsFeed(): Promise<string> {
        if (!this.config.icsFeedUrl) {
            throw new CanvasRequestError(
                isBundleInstall()
                    ? 'No calendar feed configured. Add one in Settings > Extensions > Canvas: ' +
                      'in Canvas, open Calendar and click "Calendar Feed" to get the URL.'
                    : 'CANVAS_ICS_FEED_URL is not configured.',
            );
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            // Deliberately unauthenticated: the feed code is the credential, and
            // this path must keep working when the session cookie is dead.
            const response = await fetch(this.config.icsFeedUrl, {
                method: 'GET',
                headers: { 'User-Agent': 'canvas-mcp (personal read-only client)' },
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new CanvasRequestError(
                    `Calendar feed returned ${response.status}. Re-copy the URL from Canvas > Calendar > Calendar Feed.`,
                    response.status,
                );
            }
            return await response.text();
        } finally {
            clearTimeout(timer);
        }
    }
}
