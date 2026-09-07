/**
 * get_upcoming_work — the flagship tool.
 *
 * Backed by Canvas's planner endpoint, which already unifies assignments,
 * quizzes, discussions, calendar events and to-dos and carries submission state
 * inline. One call, no client-side merging.
 */

import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { CanvasClient } from '../canvas/client.js';
import { courseLabel, courseMap, getActiveCourses, getPlannerItems } from '../canvas/queries.js';
import type { CanvasCourse, CanvasPlannerItem } from '../canvas/types.js';
import { dayKey, describeDay, formatTime, idToString, parseDate, pluralize } from '../format.js';
import { renderIcsFallback } from './fallback.js';
import { guard, READ_ONLY } from './shared.js';

/** How far back `include_overdue` looks for unsubmitted work. */
const OVERDUE_LOOKBACK_DAYS = 30;

export interface PlannerEntry {
    item: CanvasPlannerItem;
    date: Date;
    title: string;
    course: string;
    status: string;
    /** True when it is past due and still not submitted or marked done. */
    isOverdue: boolean;
    points?: number | null;
    url?: string;
}

const TYPE_LABELS: Record<string, string> = {
    assignment: 'Assignment',
    quiz: 'Quiz',
    discussion_topic: 'Discussion',
    wiki_page: 'Page',
    planner_note: 'To-do',
    calendar_event: 'Event',
    assessment_request: 'Peer review',
    sub_assignment: 'Sub-assignment',
};

function typeLabel(item: CanvasPlannerItem): string {
    const raw = item.plannable_type ?? '';
    return TYPE_LABELS[raw] ?? (raw ? raw.replace(/_/g, ' ') : 'Item');
}

/**
 * Turns Canvas's submission flags into one short phrase.
 *
 * Order matters: excused beats graded beats submitted. `marked_complete` on the
 * planner override is how you tick off a to-do that has no submission at all,
 * so it counts as done.
 */
function describeStatus(
    item: CanvasPlannerItem,
    date: Date,
    now: Date,
): { status: string; isOverdue: boolean } {
    const submissions = item.submissions;
    const markedComplete = item.planner_override?.marked_complete === true;
    const isPast = date.getTime() < now.getTime();

    if (markedComplete) return { status: 'marked done', isOverdue: false };

    // `submissions` is `false` for items that cannot be submitted (events, notes).
    if (!submissions || typeof submissions !== 'object') {
        return { status: isPast ? 'past' : 'scheduled', isOverdue: false };
    }

    if (submissions.excused) return { status: 'excused', isOverdue: false };
    if (submissions.graded) {
        return { status: submissions.has_feedback ? 'graded (has feedback)' : 'graded', isOverdue: false };
    }
    if (submissions.submitted) {
        return { status: submissions.late ? 'submitted late' : 'submitted', isOverdue: false };
    }
    if (submissions.missing) return { status: 'MISSING', isOverdue: true };
    if (isPast) return { status: 'NOT SUBMITTED — overdue', isOverdue: true };
    return { status: 'not submitted', isOverdue: false };
}

/** Normalizes raw planner items into something renderable, dropping undated ones. */
export function toEntries(
    items: CanvasPlannerItem[],
    courses: Map<string, CanvasCourse>,
    now: Date,
): PlannerEntry[] {
    const entries: PlannerEntry[] = [];

    for (const item of items) {
        const date = parseDate(item.plannable_date ?? item.plannable?.due_at ?? item.plannable?.todo_date);
        if (!date) continue;

        const courseId = idToString(item.course_id);
        const course = item.context_name ?? courseLabel(courses.get(courseId), courseId);
        const title = item.plannable?.title ?? item.plannable?.name ?? '(untitled)';
        const { status, isOverdue } = describeStatus(item, date, now);

        entries.push({
            item,
            date,
            title,
            course,
            status,
            isOverdue,
            points: item.plannable?.points_possible ?? null,
            url: item.html_url,
        });
    }

    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    return entries;
}

/** Groups entries by calendar day and renders them under day headings. */
export function renderEntries(entries: PlannerEntry[], now: Date): string {
    if (entries.length === 0) return '';

    const groups = new Map<string, PlannerEntry[]>();
    for (const entry of entries) {
        const key = dayKey(entry.date);
        const bucket = groups.get(key);
        if (bucket) bucket.push(entry);
        else groups.set(key, [entry]);
    }

    const blocks: string[] = [];
    for (const [, group] of groups) {
        const first = group[0];
        if (!first) continue;
        const lines = group.map((entry) => {
            const points = typeof entry.points === 'number' ? `, ${entry.points} pts` : '';
            const label = typeLabel(entry.item);
            return `  - [${entry.course}] ${entry.title} — ${label}${points}, ${formatTime(entry.date)} — **${entry.status}**`;
        });
        blocks.push(`### ${describeDay(first.date, now)}\n${lines.join('\n')}`);
    }

    return blocks.join('\n\n');
}

export function registerWorkTools(server: McpServer, client: CanvasClient): void {
    server.registerTool(
        'get_upcoming_work',
        {
            title: 'Upcoming Canvas work',
            description:
                'Everything due soon across all Canvas courses — assignments, quizzes, discussions, ' +
                'calendar events and to-dos — grouped by day, with submission status on each item. ' +
                'By default also surfaces anything already overdue and still unsubmitted. ' +
                'This is the right tool for "what do I have due", "what am I behind on", ' +
                'and "what is coming up this week".',
            inputSchema: z.object({
                days_ahead: z
                    .number()
                    .int()
                    .min(1)
                    .max(90)
                    .optional()
                    .describe('How many days forward to look. Defaults to 7.'),
                include_overdue: z
                    .boolean()
                    .optional()
                    .describe(
                        'Also include past-due items that are still unsubmitted, looking back 30 days. Defaults to true.',
                    ),
                course_id: z
                    .string()
                    .optional()
                    .describe('Restrict to a single course id (from list_courses).'),
            }),
            annotations: READ_ONLY,
        },
        async ({ days_ahead, include_overdue, course_id }) =>
            guard(
                async () => {
                    const daysAhead = days_ahead ?? 7;
                    const includeOverdue = include_overdue ?? true;
                    const now = new Date();

                    const start = includeOverdue
                        ? new Date(now.getTime() - OVERDUE_LOOKBACK_DAYS * 86_400_000)
                        : now;
                    const end = new Date(now.getTime() + daysAhead * 86_400_000);

                    const [items, courses] = await Promise.all([
                        getPlannerItems(client, start, end),
                        getActiveCourses(client),
                    ]);

                    let entries = toEntries(items, courseMap(courses), now);

                    if (course_id) {
                        entries = entries.filter((entry) => idToString(entry.item.course_id) === course_id);
                    }

                    // Past-dated items are only worth showing if you still owe them.
                    const upcoming = entries.filter((entry) => entry.date.getTime() >= now.getTime());
                    const overdue = includeOverdue
                        ? entries.filter((entry) => entry.date.getTime() < now.getTime() && entry.isOverdue)
                        : [];

                    const parts: string[] = [];

                    if (overdue.length > 0) {
                        parts.push(
                            `# ⚠ Overdue and unsubmitted (${overdue.length})\n\n${renderEntries(overdue, now)}`,
                        );
                    }

                    const heading = `# Due in the next ${pluralize(daysAhead, 'day')}`;
                    parts.push(
                        upcoming.length > 0
                            ? `${heading} (${upcoming.length})\n\n${renderEntries(upcoming, now)}`
                            : `${heading}\n\n_Nothing scheduled._`,
                    );

                    if (overdue.length === 0 && upcoming.length === 0) {
                        parts.push(
                            '_Note: an empty result can also mean the planner has no dated items for this ' +
                                'window. Try a larger days_ahead, or run check_canvas_auth to confirm the ' +
                                'connection is live._',
                        );
                    }

                    return parts.join('\n\n');
                },
                // Cookie dead: fall back to the token-free calendar feed so
                // deadlines survive an expired session.
                () => renderIcsFallback(client, days_ahead ?? 7),
            ),
    );
}
