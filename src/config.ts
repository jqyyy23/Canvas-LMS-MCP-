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

/**
 * An optional `user_config` field the student left blank can reach us as the
 * literal string `${user_config.ics_feed_url}` rather than as nothing at all.
 * Treating that as a real value produces a baffling failure deep inside a
 * request, so unsubstituted placeholders are read as empty here, for every key.
 */
function clean(value: string | undefined): string {
    const trimmed = (value ?? '').trim();
    return /^\$\{[A-Za-z_]+(\.[A-Za-z0-9_]+)*\}$/.test(trimmed) ? '' : trimmed;
}

/**
 * Whether this copy is running as an installed `.mcpb` extension rather than
 * from a git checkout. Set by `manifest.json`; nothing else sets it.
 */
export function isBundleInstall(env: NodeJS.ProcessEnv = process.env): boolean {
    return clean(env['CANVAS_INSTALL']) === 'mcpb';
}

/**
 * How to fetch the session cookie, worded for how this copy was installed.
 *
 * An extension has no `.env` and no terminal: the student refreshes the cookie by
 * editing a field in Claude Desktop's settings, which restarts the server for
 * them. Directing them to edit a file they cannot see is the worst thing this
 * message could do, so the last step forks and everything around it is shared.
 */
export function cookieSetupSteps(
    cookieName: string,
    env: NodeJS.ProcessEnv = process.env,
): string {
    return [
        '  1. Log into Canvas in Chrome.',
        '  2. Press F12 and open the Application tab.',
        '  3. Storage > Cookies > your Canvas domain.',
        `  4. Copy the Value of the \`${cookieName}\` cookie.`,
        ...(isBundleInstall(env)
            ? [
                  '  5. In Claude Desktop open Settings > Extensions > Canvas, paste it into',
                  '     "Canvas session cookie", and save. The extension restarts itself.',
              ]
            : [
                  '  5. Paste it into CANVAS_SESSION_COOKIE in .env, or run `npm run cookie`,',
                  '     which takes it from your clipboard and verifies it on the spot.',
              ]),
        '',
        'The cookie is httpOnly, so `document.cookie` in the console will not show it —',
        'the Application tab is the only place to read it.',
    ].join('\n');
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
            isBundleInstall(env)
                ? 'No Canvas address set. Open Settings > Extensions > Canvas in Claude ' +
                  'Desktop and set "Canvas address" to https://canvas.ubc.ca'
                : 'CANVAS_BASE_URL is not set. Copy .env.example to .env and set it to your ' +
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
            (isBundleInstall(env)
                ? 'No Canvas session cookie set yet.\n\n'
                : 'No Canvas credentials found. Set CANVAS_SESSION_COOKIE.\n\n') +
                cookieSetupSteps(sessionCookieName, env) +
                '\n\nIf there is no cookie by that name, your Canvas calls it something ' +
                'else (upstream Canvas ships `_normandy_session`); set ' +
                'CANVAS_SESSION_COOKIE_NAME to match.',
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
