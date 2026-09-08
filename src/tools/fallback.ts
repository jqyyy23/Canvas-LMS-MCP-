/**
 * Degraded-mode rendering from the token-free ICS calendar feed.
 *
 * Used when the session cookie has expired. Deadlines still work; announcements
 * and grades genuinely cannot, and the banner says so rather than letting a thin
 * result look like a complete one.
 */

import { CanvasClient } from '../canvas/client.js';
import { eventsInWindow, parseIcs } from '../canvas/ics.js';
import { isBundleInstall } from '../config.js';
import { dayKey, describeDay, formatTime } from '../format.js';

/**
 * Shown at the top of every degraded answer. It names the one action that fixes
 * things, which is a different action depending on how this copy was installed —
 * an extension user has no `.env` and no terminal to refresh from.
 */
export const DEGRADED_BANNER = [
    '> ⚠ **Degraded mode — Canvas session expired.**',
    '> Showing deadlines from your calendar feed only. Submission status, announcements',
    isBundleInstall()
        ? '> and grades stay unavailable until you paste a fresh session cookie into' +
          ' Settings > Extensions > Canvas.'
        : '> and grades are unavailable until you refresh `CANVAS_SESSION_COOKIE` in `.env`.',
].join('\n');

/**
 * Renders upcoming deadlines from the calendar feed.
 *
 * Returns undefined when no feed is configured, so callers can fall through to
 * the original auth error rather than reporting a second, less useful failure.
 */
export async function renderIcsFallback(
    client: CanvasClient,
    daysAhead: number,
    now = new Date(),
): Promise<string | undefined> {
    if (!client.icsFeedUrl) return undefined;

    let raw: string;
    try {
        raw = await client.fetchIcsFeed();
    } catch {
        // The feed is a best-effort backstop; if it fails too, the caller's
        // original auth error is the more useful thing to report.
        return undefined;
    }

    const events = eventsInWindow(parseIcs(raw), now, new Date(now.getTime() + daysAhead * 86_400_000));

    if (events.length === 0) {
        return `${DEGRADED_BANNER}\n\n# Due in the next ${daysAhead} days\n\n_Nothing in the calendar feed for this window._`;
    }

    const groups = new Map<string, typeof events>();
    for (const event of events) {
        const key = dayKey(event.start);
        const bucket = groups.get(key);
        if (bucket) bucket.push(event);
        else groups.set(key, [event]);
    }

    const blocks: string[] = [];
    for (const [, group] of groups) {
        const first = group[0];
        if (!first) continue;
        const lines = group.map((event) => {
            const course = event.course ? `[${event.course}] ` : '';
            const link = event.url ? ` <${event.url}>` : '';
            return `  - ${course}${event.summary} — ${formatTime(event.start)}${link}`;
        });
        blocks.push(`### ${describeDay(first.start, now)}\n${lines.join('\n')}`);
    }

    return `${DEGRADED_BANNER}\n\n# Due in the next ${daysAhead} days (${events.length})\n\n${blocks.join('\n\n')}`;
}
