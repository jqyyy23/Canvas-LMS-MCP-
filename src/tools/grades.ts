/**
 * get_grades.
 *
 * Course-level scores come from the enrollment objects. Recently graded work is
 * an opt-in extra because it costs one request per course.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { CanvasClient } from '../canvas/client.js';
import {
    courseLabel,
    courseMap,
    getActiveCourses,
    getCourseAssignments,
    getEnrollments,
} from '../canvas/queries.js';
import type { CanvasAssignment, CanvasCourse } from '../canvas/types.js';
import { formatDateTime, formatScore, idToString, parseDate } from '../format.js';
import { guard, READ_ONLY } from './shared.js';

/** How far back "recently graded" reaches. */
const RECENT_GRADED_DAYS = 14;

export interface GradedItem {
    course: string;
    assignment: CanvasAssignment;
    gradedAt: Date;
}

/** Assignments graded within the window, newest first. */
export async function findRecentlyGraded(
    client: CanvasClient,
    courses: CanvasCourse[],
    since: Date,
): Promise<GradedItem[]> {
    const perCourse = await Promise.all(
        courses.map(async (course) => {
            const courseId = idToString(course.id);
            try {
                const assignments = await getCourseAssignments(client, courseId, 'past');
                return assignments
                    .map((assignment) => {
                        const gradedAt = parseDate(assignment.submission?.graded_at);
                        return gradedAt && gradedAt >= since
                            ? { course: courseLabel(course), assignment, gradedAt }
                            : undefined;
                    })
                    .filter((item): item is GradedItem => item !== undefined);
            } catch {
                // One unreadable course must not sink the whole grade report.
                return [];
            }
        }),
    );

    return perCourse.flat().sort((a, b) => b.gradedAt.getTime() - a.gradedAt.getTime());
}

export function renderGradedItems(items: GradedItem[]): string {
    return items
        .map((item) => {
            const submission = item.assignment.submission;
            const score = formatScore(submission?.score ?? null, submission?.grade ?? null);
            const outOf =
                typeof item.assignment.points_possible === 'number'
                    ? ` / ${item.assignment.points_possible}`
                    : '';
            return `- [${item.course}] ${item.assignment.name ?? '(untitled)'} — **${score}${outOf}** (graded ${formatDateTime(item.gradedAt.toISOString())})`;
        })
        .join('\n');
}

export function registerGradeTools(server: McpServer, client: CanvasClient): void {
    server.registerTool(
        'get_grades',
        {
            title: 'Canvas grades',
            description:
                'Your current grade in each active Canvas course, and optionally the individual ' +
                'assignments graded recently. Use this for "how am I doing", "what are my grades", ' +
                'or "did anything get graded".',
            inputSchema: z.object({
                include_recent_graded: z
                    .boolean()
                    .optional()
                    .describe(
                        'Also list individual assignments graded in the last 14 days. Costs one request per course. Defaults to true.',
                    ),
            }),
            annotations: READ_ONLY,
        },
        async ({ include_recent_graded }) =>
            guard(async () => {
                const includeRecent = include_recent_graded ?? true;
                const [courses, enrollments] = await Promise.all([
                    getActiveCourses(client),
                    getEnrollments(client),
                ]);

                if (courses.length === 0) {
                    return 'No active courses found. Run check_canvas_auth to confirm the connection is live.';
                }

                const byCourse = courseMap(courses);
                const lines = enrollments
                    .map((enrollment) => {
                        const courseId = idToString(enrollment.course_id);
                        const course = byCourse.get(courseId);
                        // Enrollments can outlive the visible course list; skip those.
                        if (!course) return undefined;
                        const score = formatScore(
                            enrollment.grades?.current_score,
                            enrollment.grades?.current_grade,
                        );
                        return `- **${courseLabel(course)}**: ${score}`;
                    })
                    .filter((line): line is string => line !== undefined);

                const parts = [
                    lines.length > 0
                        ? `# Current grades\n\n${lines.join('\n')}`
                        : '# Current grades\n\n_No graded enrollments found._',
                ];

                if (includeRecent) {
                    const since = new Date(Date.now() - RECENT_GRADED_DAYS * 86_400_000);
                    const graded = await findRecentlyGraded(client, courses, since);
                    parts.push(
                        graded.length > 0
                            ? `# Graded in the last ${RECENT_GRADED_DAYS} days (${graded.length})\n\n${renderGradedItems(graded)}`
                            : `# Graded in the last ${RECENT_GRADED_DAYS} days\n\n_Nothing new._`,
                    );
                }

                parts.push(
                    '_Note: course grades reflect only what has been graded so far and may exclude ungraded work._',
                );

                return parts.join('\n\n');
            }),
    );
}
