/**
 * get_daily_briefing — the reason this server exists.
 *
 * One call that answers "what do I need to know right now", so Canvas can be
 * checked in the same breath as email instead of on a separate site. Everything
 * here runs off the shared TTL cache, so composing four views costs little more
 * than requesting one.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { CanvasClient } from '../canvas/client.js';
import { courseMap, getActiveCourses, getAnnouncements, getPlannerItems } from '../canvas/queries.js';
import { renderAnnouncements } from './announcements.js';
import { renderIcsFallback } from './fallback.js';
import { findRecentlyGraded, renderGradedItems } from './grades.js';
import { renderEntries, toEntries } from './work.js';
import { pluralize } from '../format.js';
import { guard, READ_ONLY } from './shared.js';

const OVERDUE_LOOKBACK_DAYS = 30;
/** Announcement bodies are trimmed harder here than in the dedicated tool. */
const BRIEFING_BODY_CHARS = 350;

export function registerBriefingTool(server: McpServer, client: CanvasClient): void {
    server.registerTool(
        'get_daily_briefing',
        {
            title: 'Canvas daily briefing',
            description:
                'One consolidated Canvas digest: work due soon, anything overdue and unsubmitted, ' +
                'new announcements, and recently graded assignments. This is the tool to call for ' +
                '"catch me up on school", "what do I need to know today", or alongside an email ' +
                'check for a single morning rundown. Prefer this over calling the individual ' +
                'Canvas tools one by one.',
            inputSchema: z.object({
                days_ahead: z
                    .number()
                    .int()
                    .min(1)
                    .max(30)
                    .optional()
                    .describe('How far forward to look for due work. Defaults to 7.'),
                hours_back: z
                    .number()
                    .int()
                    .min(1)
                    .max(720)
                    .optional()
                    .describe('Window for "new" announcements and grades. Defaults to 24 hours.'),
            }),
            annotations: READ_ONLY,
        },
        async ({ days_ahead, hours_back }) =>
            guard(
                async () => {
                    const daysAhead = days_ahead ?? 7;
                    const hoursBack = hours_back ?? 24;
                    const now = new Date();
                    const since = new Date(now.getTime() - hoursBack * 3_600_000);

                    const courses = await getActiveCourses(client);
                    if (courses.length === 0) {
                        return 'No active Canvas courses found. Run check_canvas_auth — an expired session cookie looks the same as an empty account.';
                    }

                    const plannerStart = new Date(now.getTime() - OVERDUE_LOOKBACK_DAYS * 86_400_000);
                    const plannerEnd = new Date(now.getTime() + daysAhead * 86_400_000);
                    // Slightly ahead of now, so something posted moments ago isn't
                    // dropped by clock skew between here and Canvas.
                    const announcementEnd = new Date(now.getTime() + 60 * 60_000);

                    // Each section degrades independently: a failure in grades should
                    // still leave you with your deadlines.
                    const [plannerItems, announcements, graded] = await Promise.all([
                        getPlannerItems(client, plannerStart, plannerEnd).catch(() => []),
                        getAnnouncements(client, courses, since, announcementEnd).catch(() => []),
                        findRecentlyGraded(client, courses, since).catch(() => []),
                    ]);

                    const byCourse = courseMap(courses);
                    const entries = toEntries(plannerItems, byCourse, now);
                    const overdue = entries.filter(
                        (entry) => entry.date.getTime() < now.getTime() && entry.isOverdue,
                    );
                    const upcoming = entries.filter((entry) => entry.date.getTime() >= now.getTime());

                    const headline = [
                        `${pluralize(upcoming.length, 'item')} due in the next ${pluralize(daysAhead, 'day')}`,
                        `${pluralize(overdue.length, 'overdue item')}`,
                        `${pluralize(announcements.length, 'new announcement')}`,
                        `${pluralize(graded.length, 'newly graded item')}`,
                    ].join(' · ');

                    const parts = [
                        `# Canvas briefing — ${now.toLocaleString('en-US', {
                            weekday: 'long',
                            month: 'long',
                            day: 'numeric',
                        })}`,
                        `_${headline}_`,
                    ];

                    if (overdue.length > 0) {
                        parts.push(`## ⚠ Overdue and unsubmitted\n\n${renderEntries(overdue, now)}`);
                    }

                    parts.push(
                        upcoming.length > 0
                            ? `## Due in the next ${pluralize(daysAhead, 'day')}\n\n${renderEntries(upcoming, now)}`
                            : `## Due in the next ${pluralize(daysAhead, 'day')}\n\n_Nothing scheduled._`,
                    );

                    parts.push(
                        announcements.length > 0
                            ? `## New announcements (last ${pluralize(hoursBack, 'hour')})\n\n${renderAnnouncements(announcements, byCourse, BRIEFING_BODY_CHARS)}`
                            : `## New announcements (last ${pluralize(hoursBack, 'hour')})\n\n_None._`,
                    );

                    parts.push(
                        graded.length > 0
                            ? `## Newly graded (last ${pluralize(hoursBack, 'hour')})\n\n${renderGradedItems(graded)}`
                            : `## Newly graded (last ${pluralize(hoursBack, 'hour')})\n\n_Nothing new._`,
                    );

                    return parts.join('\n\n');
                },
                // Cookie dead: deadlines from the calendar feed are still far
                // better than nothing for a morning catch-up.
                () => renderIcsFallback(client, days_ahead ?? 7),
            ),
    );
}
