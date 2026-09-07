/**
 * Environment configuration.
 *
 * Loaded once at startup. Anything invalid fails fast with a message that says
 * what to fix, because a misconfigured server is by far the most likely problem
 * you will hit with this thing.
 */

export interface CanvasConfig {
    /** Origin only, no trailing slash, e.g. `https://school.instructure.com`. */
    baseUrl: string;
    /** `_normandy_session` cookie value. Empty when using a token instead. */
    sessionCookie: string;
    /** Optional `pseudonym_credentials` cookie — extends usable life to ~2 weeks. */
    rememberCookie: string;
    /** Optional personal access token. Takes priority over cookies when present. */
    accessToken: string;
    /** Optional token-free ICS calendar feed, used as a fallback when auth dies. */
    icsFeedUrl: string;
}

export class ConfigError extends Error {}

function clean(value: string | undefined): string {
    return (value ?? '').trim();
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
    const sessionCookie = normalizeCookieValue(clean(env['CANVAS_SESSION_COOKIE']), '_normandy_session');
    const rememberCookie = normalizeCookieValue(
        clean(env['CANVAS_REMEMBER_COOKIE']),
        'pseudonym_credentials',
    );

    if (!accessToken && !sessionCookie && !rememberCookie) {
        throw new ConfigError(
            'No Canvas credentials found. Set CANVAS_SESSION_COOKIE in .env to your ' +
                '`_normandy_session` cookie value.\n\n' +
                'To get it: log into Canvas in Chrome, press F12, open the Application tab, ' +
                'then Storage > Cookies > your Canvas domain, and copy the Value of ' +
                '`_normandy_session`. It is httpOnly, so `document.cookie` in the console ' +
                'will not show it — the Application tab is the only way.',
        );
    }

    return {
        baseUrl,
        sessionCookie,
        rememberCookie,
        accessToken,
        icsFeedUrl: clean(env['CANVAS_ICS_FEED_URL']),
    };
}
