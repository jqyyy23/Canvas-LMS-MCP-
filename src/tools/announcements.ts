/**
 * get_announcements.
 *
 * The Canvas endpoint requires `context_codes[]`, so the course list is resolved
 * first (cached, so this is usually free).
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { CanvasClient } from '../canvas/client.js';
import {
    announcementCourseId,
    courseLabel,
    courseMap,
    getActiveCourses,
    getAnnouncements,
} from '../canvas/queries.js';
import type { CanvasAnnouncement, CanvasCourse } from '../canvas/types.js';
import { htmlSummary } from '../canvas/html.js';
import { formatDateTime, parseDate } from '../format.js';
import { guard, READ_ONLY } from './shared.js';

/** Enough to know whether an announcement matters, short enough to stay cheap. */
const BODY_CHARS = 600;

export function renderAnnouncements(
    announcements: CanvasAnnouncement[],
    courses: Map<string, CanvasCourse>,
    bodyChars = BODY_CHARS,
): string {
    const sorted = [...announcements].sort((a, b) => {
        const aTime = parseDate(a.posted_at)?.getTime() ?? 0;
        const bTime = parseDate(b.posted_at)?.getTime() ?? 0;
        return bTime - aTime; // newest first
    });

    return sorted
        .map((announcement) => {
            const courseId = announcementCourseId(announcement);
            const course = courseLabel(courses.get(courseId), courseId);
            const author = announcement.author?.display_name ?? announcement.user_name;
            const byline = author ? ` by ${author}` : '';
            const body = htmlSummary(announcement.message, bodyChars, 'open the html_url for the full text');
            const url = announcement.html_url ?? announcement.url;

            return [
                `### [${course}] ${announcement.title ?? '(untitled)'}`,
                `_${formatDateTime(announcement.posted_at, 'not yet posted')}${byline}_`,
                body || '_(no body)_',
                url ? `<${url}>` : '',
            ]
                .filter(Boolean)
                .join('\n');
        })
        .join('\n\n');
}

export function registerAnnouncementTools(server: McpServer, client: CanvasClient): void {
    server.registerTool(
        'get_announcements',
        {
            title: 'Recent Canvas announcements',
            description:
                'Recent announcements posted by instructors across your active Canvas courses, ' +
                'newest first, with the body text included. Use this for "what did my professors ' +
                'post", "any class news", or to catch up after time away.',
            inputSchema: z.object({
                days_back: z
                    .number()
                    .int()
                    .min(1)
                    .max(90)
                    .optional()
                    .describe('How many days back to look. Defaults to 7.'),
                course_id: z
                    .string()
                    .optional()
                    .describe('Restrict to a single course id (from list_courses).'),
            }),
            annotations: READ_ONLY,
        },
        async ({ days_back, course_id }) =>
            guard(async () => {
                const daysBack = days_back ?? 7;
                const now = new Date();
                const start = new Date(now.getTime() - daysBack * 86_400_000);

                const allCourses = await getActiveCourses(client);
                const scoped = course_id
                    ? allCourses.filter((course) => String(course.id) === course_id)
                    : allCourses;

                if (scoped.length === 0) {
                    return course_id
                        ? `No active course found with id ${course_id}. Run list_courses to see valid ids.`
                        : 'No active courses found, so there are no announcements to read.';
                }

                // end_date is set slightly ahead so an announcement posted moments
                // ago isn't excluded by clock skew between here and Canvas.
                const end = new Date(now.getTime() + 60 * 60_000);
                const announcements = await getAnnouncements(client, scoped, start, end);

                if (announcements.length === 0) {
                    return `# Announcements\n\n_No announcements in the last ${daysBack} days._`;
                }

                const body = renderAnnouncements(announcements, courseMap(allCourses));
                return `# Announcements — last ${daysBack} days (${announcements.length})\n\n${body}`;
            }),
    );
}
