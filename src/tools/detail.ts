/**
 * get_course_detail and get_assignment_detail — the drill-down tools, used once
 * a roll-up has pointed at something specific.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { CanvasClient } from '../canvas/client.js';
import { courseLabel } from '../canvas/queries.js';
import type { CanvasAssignment, CanvasCourse, CanvasModule, CanvasUser } from '../canvas/types.js';
import { htmlSummary, htmlToText } from '../canvas/html.js';
import { formatDateTime, formatScore, idToString } from '../format.js';
import { guard, READ_ONLY } from './shared.js';

const SYLLABUS_CHARS = 2500;
const DESCRIPTION_CHARS = 4000;

function renderModules(modules: CanvasModule[]): string {
    if (modules.length === 0) return '_No modules published._';

    return modules
        .map((module) => {
            const items = module.items ?? [];
            const done = items.filter((item) => item.completion_requirement?.completed).length;
            const required = items.filter((item) => item.completion_requirement).length;
            const progress = required > 0 ? ` — ${done}/${required} requirements done` : '';
            const state = module.state ? ` [${module.state}]` : '';

            // Only itemize modules you are actually working through; a completed
            // module's contents are noise in a summary.
            const detail =
                module.state === 'completed' || items.length === 0
                    ? ''
                    : '\n' +
                      items
                          .slice(0, 15)
                          .map((item) => {
                              const check = item.completion_requirement
                                  ? item.completion_requirement.completed
                                      ? '[x] '
                                      : '[ ] '
                                  : '';
                              return `    - ${check}${item.title ?? '(untitled)'}${item.type ? ` (${item.type})` : ''}`;
                          })
                          .join('\n');

            return `  - **${module.name ?? '(untitled module)'}**${state}${progress}${detail}`;
        })
        .join('\n');
}

export function registerDetailTools(server: McpServer, client: CanvasClient): void {
    server.registerTool(
        'get_course_detail',
        {
            title: 'Canvas course detail',
            description:
                'Everything about one course: syllabus, module progress, and instructor contact ' +
                'details. Use after list_courses when you need the specifics of a single class.',
            inputSchema: z.object({
                course_id: z.string().describe('Course id from list_courses.'),
            }),
            annotations: READ_ONLY,
        },
        async ({ course_id }) =>
            guard(async () => {
                const course = await client.get<CanvasCourse>(`/api/v1/courses/${course_id}`, {
                    'include[]': ['syllabus_body', 'term', 'total_scores'],
                });

                // Modules and teachers are frequently restricted or simply absent;
                // neither should fail the whole call.
                const [modules, teachers] = await Promise.all([
                    client
                        .getAll<CanvasModule>(`/api/v1/courses/${course_id}/modules`, {
                            'include[]': ['items'],
                        })
                        .catch(() => [] as CanvasModule[]),
                    client
                        .getAll<CanvasUser>(`/api/v1/courses/${course_id}/users`, {
                            'enrollment_type[]': ['teacher', 'ta'],
                        })
                        .catch(() => [] as CanvasUser[]),
                ]);

                const enrollment = course.enrollments?.[0];
                const grade = enrollment?.grades
                    ? formatScore(enrollment.grades.current_score, enrollment.grades.current_grade)
                    : 'no grade yet';

                const staff =
                    teachers.length > 0
                        ? teachers
                              .map((teacher) => {
                                  const email = teacher.email ?? teacher.primary_email;
                                  return `  - ${teacher.name ?? 'unknown'}${email ? ` — ${email}` : ''}`;
                              })
                              .join('\n')
                        : '  _Not visible to students on this course._';

                const syllabus = htmlSummary(
                    course.syllabus_body,
                    SYLLABUS_CHARS,
                    'view the full syllabus in Canvas',
                );

                return [
                    `# ${courseLabel(course)}`,
                    `- course_id: \`${idToString(course.id)}\``,
                    course.course_code ? `- Code: ${course.course_code}` : '',
                    course.term?.name ? `- Term: ${course.term.name}` : '',
                    `- Current grade: ${grade}`,
                    '',
                    '## Instructors',
                    staff,
                    '',
                    '## Modules',
                    renderModules(modules),
                    '',
                    '## Syllabus',
                    syllabus || '_No syllabus posted._',
                ]
                    .filter((line) => line !== '')
                    .join('\n');
            }),
    );

    server.registerTool(
        'get_assignment_detail',
        {
            title: 'Canvas assignment detail',
            description:
                'The full text of one assignment: instructions, due date, points, accepted ' +
                'submission types, rubric, and your own submission status. Use when you need to ' +
                'know what an assignment actually asks for.',
            inputSchema: z.object({
                course_id: z.string().describe('Course id from list_courses.'),
                assignment_id: z
                    .string()
                    .describe('Assignment id, e.g. from the html_url shown by get_upcoming_work.'),
            }),
            annotations: READ_ONLY,
        },
        async ({ course_id, assignment_id }) =>
            guard(async () => {
                const assignment = await client.get<CanvasAssignment>(
                    `/api/v1/courses/${course_id}/assignments/${assignment_id}`,
                    { 'include[]': ['submission'] },
                );

                const submission = assignment.submission;
                const statusLines: string[] = [];
                if (!submission) {
                    statusLines.push('- No submission record.');
                } else {
                    statusLines.push(
                        `- Submitted: ${submission.submitted_at ? formatDateTime(submission.submitted_at) : 'not submitted'}`,
                    );
                    if (submission.graded_at) {
                        statusLines.push(
                            `- Graded: ${formatScore(submission.score, submission.grade)} on ${formatDateTime(submission.graded_at)}`,
                        );
                    }
                    if (submission.late) statusLines.push('- Marked **late**.');
                    if (submission.missing) statusLines.push('- Marked **missing**.');
                    if (submission.excused) statusLines.push('- Marked **excused**.');
                }

                const rubric =
                    assignment.rubric && assignment.rubric.length > 0
                        ? assignment.rubric
                              .map(
                                  (row) =>
                                      `  - ${row.description ?? '(criterion)'}${typeof row.points === 'number' ? ` — ${row.points} pts` : ''}`,
                              )
                              .join('\n')
                        : '';

                return [
                    `# ${assignment.name ?? '(untitled assignment)'}`,
                    `- Due: ${formatDateTime(assignment.due_at, 'no due date')}`,
                    typeof assignment.points_possible === 'number'
                        ? `- Points: ${assignment.points_possible}`
                        : '',
                    assignment.submission_types?.length
                        ? `- Submission types: ${assignment.submission_types.join(', ')}`
                        : '',
                    assignment.lock_at ? `- Locks: ${formatDateTime(assignment.lock_at)}` : '',
                    assignment.html_url ? `- Link: <${assignment.html_url}>` : '',
                    '',
                    '## Your submission',
                    statusLines.join('\n'),
                    rubric ? `\n## Rubric\n${rubric}` : '',
                    '',
                    '## Instructions',
                    htmlSummary(
                        assignment.description,
                        DESCRIPTION_CHARS,
                        'open the link above for the rest',
                    ) || '_No description provided._',
                ]
                    .filter((line) => line !== '')
                    .join('\n');
            }),
    );
}

// Re-exported for the smoke script, which renders a description without MCP.
export { htmlToText };
