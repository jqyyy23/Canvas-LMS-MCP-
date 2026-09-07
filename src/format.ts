/**
 * Shared output formatting.
 *
 * Every tool returns compact text rather than raw JSON. That is the main lever on
 * both token cost and answer quality — a model reads "Due tomorrow (Tue Sep 8),
 * 11:59pm — not submitted" far better than it reads a 40-key object.
 */

import type { CanvasId } from './canvas/types.js';

/** Canvas ids may arrive as string or number; normalize for comparison and display. */
export function idToString(id: CanvasId | undefined | null): string {
    return id === undefined || id === null ? '' : String(id);
}

export function parseDate(value: string | null | undefined): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Local-time date key (`YYYY-MM-DD`) used for grouping by day. */
export function dayKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

const DAY_MS = 86_400_000;

/** Whole days between two local calendar dates (ignores time of day). */
function calendarDayDiff(from: Date, to: Date): number {
    const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
    const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
    return Math.round((b - a) / DAY_MS);
}

/**
 * "Today (Mon Sep 7)", "Tomorrow (Tue Sep 8)", "Overdue 3 days (Thu Sep 4)".
 * Relative framing is what you actually care about when scanning deadlines.
 */
export function describeDay(date: Date, now = new Date()): string {
    const diff = calendarDayDiff(now, date);
    const label = date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
    if (diff === 0) return `Today (${label})`;
    if (diff === 1) return `Tomorrow (${label})`;
    if (diff === -1) return `Yesterday (${label})`;
    if (diff < 0) return `${Math.abs(diff)} days ago (${label})`;
    return `In ${diff} days (${label})`;
}

/** Time of day, e.g. "11:59 PM". Canvas due times are meaningful. */
export function formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatDateTime(value: string | null | undefined, fallback = 'no date'): string {
    const date = parseDate(value);
    if (!date) return fallback;
    return `${describeDay(date)} at ${formatTime(date)}`;
}

/** Renders a section with a heading, or a stated-empty line. Never silently blank. */
export function section(title: string, lines: string[], emptyNote: string): string {
    const header = `## ${title}`;
    if (lines.length === 0) return `${header}\n_${emptyNote}_`;
    return `${header}\n${lines.join('\n')}`;
}

export function joinSections(parts: string[]): string {
    return parts.filter((p) => p.trim().length > 0).join('\n\n');
}

/** Percentage/letter grade pair, e.g. "88.4% (B+)". */
export function formatScore(score: number | null | undefined, grade: string | null | undefined): string {
    const hasScore = typeof score === 'number' && Number.isFinite(score);
    if (hasScore && grade) return `${score}% (${grade})`;
    if (hasScore) return `${score}%`;
    if (grade) return grade;
    return 'no grade yet';
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}
