/**
 * Environment configuration.
 *
 * Loaded at startup, and re-readable from disk afterwards so a refreshed session
 * cookie takes effect without restarting the server. Anything invalid fails fast
 * with a message that says what to fix, because a misconfigured server is by far
 * the most likely problem you will hit with this thing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Default session cookie name.
 *
 * Upstream Canvas ships `_normandy_session`, but installs routinely rename it —
 * UBC and many others use `canvas_session`. Getting this wrong is invisible:
 * Canvas simply ignores the unrecognized cookie and reports "not authenticated",
 * which looks exactly like an expired session. Hence `CANVAS_SESSION_COOKIE_NAME`.
 */
export const DEFAULT_SESSION_COOKIE_NAME = 'canvas_session';
export const REMEMBER_COOKIE_NAME = 'pseudonym_credentials';

export interface CanvasConfig {
    /** Origin only, no trailing slash, e.g. `https://school.instructure.com`. */
    baseUrl: string;
    /** Name of the session cookie on this Canvas install. */
    sessionCookieName: string;
    /** Session cookie value. Empty when using a token instead. */
    sessionCookie: string;
    /** Optional `pseudonym_credentials` cookie — extends usable life to ~2 weeks. */
    rememberCookie: string;
    /**
     * Extra raw cookies to send verbatim, e.g. `cf_clearance=…` for a Canvas
     * behind Cloudflare. Semicolon-separated `name=value` pairs.
     */
    extraCookies: string;
    /**
     * User-Agent to send. Defaults to the browser-like string below because the
     * request carries a browser session cookie and some institutions front Canvas
     * with a bot filter that rejects anything else.
     */
    userAgent: string;
    /** Optional personal access token. Takes priority over cookies when present. */
    accessToken: string;
    /** Optional token-free ICS calendar feed, used as a fallback when auth dies. */
    icsFeedUrl: string;
}

const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export class ConfigError extends Error {}

function clean(value: string | undefined): string {
    return (value ?? '').trim();
}

/**
 * Where `.env` lives, resolved from this module rather than `process.cwd()` so it
 * is found no matter what directory the MCP host launched the server from.
 */
export function envFilePath(): string {
    const override = clean(process.env['CANVAS_ENV_FILE']);
    if (override) return override;
    // build/src/config.js -> project root
    return fileURLToPath(new URL('../../.env', import.meta.url));
}

/**
 * Re-reads `.env` from disk.
 *
 * Node's `--env-file` only reads at startup, but on an SSO-backed Canvas the
 * session cookie expires daily and cannot be extended, so requiring a server
 * restart after every refresh would be the most irritating part of using this.
 * Reading the file again lets a pasted cookie take effect on the next tool call.
 *
 * Deliberately minimal: enough for `KEY=value` lines with optional quotes and
 * `#` comments, which is all this file ever contains.
 */
export function readEnvFile(path = envFilePath()): NodeJS.ProcessEnv {
    let raw: string;
    try {
        raw = readFileSync(path, 'utf8');
    } catch {
        return {};
    }

    const env: NodeJS.ProcessEnv = {};
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
}

/**
 * Cookie values pasted out of DevTools sometimes arrive wrapped in quotes, or as
 * the whole `name=value` pair rather than just the value. Both are easy mistakes
 * and both produce a baffling 401 later, so normalize them here instead.
 */
function normalizeCookieValue(raw: string, cookieName: string): string {
    let value = raw.replace(/^["']|["']$/g, '').trim();
    if (value.startsWith(`${cookieName}=`)) {
        value = value.slice(cookieName.length + 1);
    }
    return value.replace(/;$/, '').trim();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CanvasConfig {
    const rawBase = clean(env['CANVAS_BASE_URL']);
    if (!rawBase) {
        throw new ConfigError(
            'CANVAS_BASE_URL is not set. Copy .env.example to .env and set it to your ' +
                'Canvas domain, e.g. https://yourschool.instructure.com',
        );
    }

    let baseUrl: string;
    try {
        const parsed = new URL(rawBase);
        if (parsed.protocol !== 'https:') {
            throw new ConfigError(
                `CANVAS_BASE_URL must use https (got "${parsed.protocol}//"). ` +
                    'Your session cookie is a live credential and must not travel over plain http.',
            );
        }
        baseUrl = parsed.origin;
    } catch (err) {
        if (err instanceof ConfigError) throw err;
        throw new ConfigError(`CANVAS_BASE_URL is not a valid URL: "${rawBase}"`);
    }

    const accessToken = clean(env['CANVAS_ACCESS_TOKEN']);
    const sessionCookieName =
        clean(env['CANVAS_SESSION_COOKIE_NAME']) || DEFAULT_SESSION_COOKIE_NAME;
    const sessionCookie = normalizeCookieValue(
        clean(env['CANVAS_SESSION_COOKIE']),
        sessionCookieName,
    );
    const rememberCookie = normalizeCookieValue(
        clean(env['CANVAS_REMEMBER_COOKIE']),
        REMEMBER_COOKIE_NAME,
    );

    if (!accessToken && !sessionCookie && !rememberCookie) {
        throw new ConfigError(
            'No Canvas credentials found. Set CANVAS_SESSION_COOKIE in .env to your ' +
                'Canvas session cookie value.\n\n' +
                'To get it: log into Canvas in Chrome, press F12, open the Application tab, ' +
                'then Storage > Cookies > your Canvas domain. Look for a large, httpOnly ' +
                `cookie named \`${sessionCookieName}\` (some installs call it ` +
                '`_normandy_session` instead — if yours does, also set ' +
                'CANVAS_SESSION_COOKIE_NAME to match). It is httpOnly, so `document.cookie` ' +
                'in the console will not show it — the Application tab is the only way.',
        );
    }

    return {
        baseUrl,
        sessionCookieName,
        sessionCookie,
        rememberCookie,
        extraCookies: clean(env['CANVAS_EXTRA_COOKIES']).replace(/^;|;$/g, '').trim(),
        userAgent: clean(env['CANVAS_USER_AGENT']) || DEFAULT_USER_AGENT,
        accessToken,
        icsFeedUrl: clean(env['CANVAS_ICS_FEED_URL']),
    };
}
