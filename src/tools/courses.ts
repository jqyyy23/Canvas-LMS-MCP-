/**
 * list_courses and check_canvas_auth.
 *
 * The auth check exists because an expired cookie is the expected steady-state
 * failure of this server, and "is the connection alive?" should be answerable in
 * one cheap call rather than inferred from an empty deadline list.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { CanvasClient } from '../canvas/client.js';
import { courseLabel, getActiveCourses, getPendingCourseCount, getSelf } from '../canvas/queries.js';
import { formatScore, idToString } from '../format.js';
import { guard, READ_ONLY } from './shared.js';

export function registerCourseTools(server: McpServer, client: CanvasClient): void {
    server.registerTool(
        'check_canvas_auth',
        {
            title: 'Check Canvas connection',
            description:
                'Verifies the Canvas credentials work and reports who you are signed in as. ' +
                'Run this first whenever a Canvas tool returns nothing or looks wrong — it ' +
                'distinguishes "no data" from "expired session cookie".',
            inputSchema: z.object({}),
            annotations: READ_ONLY,
        },
        async () =>
            guard(async () => {
                const self = await getSelf(client);
                const courses = await getActiveCourses(client);
                const pending = await getPendingCourseCount(client).catch(() => 0);
                return [
                    '✅ Canvas connection is live.',
                    '',
                    `- Signed in as: ${self.name ?? self.short_name ?? 'unknown'}`,
                    `- User id: ${idToString(self.id)}`,
                    `- Canvas host: ${client.baseUrl}`,
                    `- Auth method: ${client.authMode}` +
                        (client.authMode === 'session cookie'
                            ? ` (\`${client.sessionCookieName}\`)`
                            : ''),
                    `- Active courses visible: ${courses.length}`,
                    ...(pending > 0
                        ? [`- Enrolled but not yet open: ${pending} (term not started / unpublished)`]
                        : []),
                    client.icsFeedUrl
                        ? '- Calendar feed fallback: configured'
                        : '- Calendar feed fallback: not configured (set CANVAS_ICS_FEED_URL)',
                ].join('\n');
            }),
    );

    server.registerTool(
        'list_courses',
        {
            title: 'List Canvas courses',
            description:
                'Lists your active Canvas courses with their ids, codes, term, and current grade. ' +
                'Use this to find the course_id that other tools take as an argument.',
            inputSchema: z.object({}),
            annotations: READ_ONLY,
        },
        async () =>
            guard(async () => {
                const [courses, pending] = await Promise.all([
                    getActiveCourses(client),
                    getPendingCourseCount(client).catch(() => 0),
                ]);

                const pendingNote =
                    pending > 0
                        ? `\n\n_${pending} further ${pending === 1 ? 'course is' : 'courses are'} enrolled but not yet open — ` +
                          'Canvas withholds them (including their names) until the term starts or the ' +
                          'instructor publishes. They will appear here automatically once they do._'
                        : '';

                if (courses.length === 0) {
                    return (
                        'No active courses found. If you expect some, run check_canvas_auth — an expired session cookie can look like an empty course list.' +
                        pendingNote
                    );
                }

                const lines = courses.map((course) => {
                    const enrollment = course.enrollments?.[0];
                    const grade = enrollment?.grades
                        ? formatScore(enrollment.grades.current_score, enrollment.grades.current_grade)
                        : 'no grade yet';
                    const term = course.term?.name ? ` — ${course.term.name}` : '';
                    // UBC sets course_code equal to the full name on many sites;
                    // echoing it back verbatim just doubles the line length.
                    const label = courseLabel(course);
                    const code =
                        course.course_code && course.course_code !== label
                            ? ` (${course.course_code})`
                            : '';
                    return `- **${label}**${code}${term}\n  - course_id: \`${idToString(course.id)}\`\n  - current grade: ${grade}`;
                });

                return `# Active courses (${courses.length})\n\n${lines.join('\n')}${pendingNote}`;
            }),
    );
}
