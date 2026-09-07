/**
 * Minimal iCalendar parser for the Canvas personal calendar feed.
 *
 * This exists because the session cookie is the fragile part of this server, and
 * the calendar feed is the one Canvas data source that needs neither a cookie nor
 * admin approval — the feed code in the URL is itself the credential. When auth
 * dies, deadlines keep working.
 *
 * Only the handful of fields we render are parsed; a full RFC 5545 implementation
 * would be a dependency and a lot of code for no extra benefit here.
 */

export interface IcsEvent {
    summary: string;
    start: Date;
    url?: string;
    description?: string;
    /** Course name, when it can be recovered from the summary suffix. */
    course?: string;
}

/**
 * Undoes RFC 5545 line folding: a CRLF followed by a space or tab is a
 * continuation, not a new line. Canvas folds long assignment titles routinely,
 * so skipping this would truncate them mid-word.
 */
function unfold(raw: string): string[] {
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines: string[] = [];
    for (const line of normalized.split('\n')) {
        if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
            lines[lines.length - 1] += line.slice(1);
        } else {
            lines.push(line);
        }
    }
    return lines;
}

/** Reverses RFC 5545 text escaping. */
function unescapeText(value: string): string {
    return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/**
 * Parses `20260908T235900Z`, `20260908T235900` and the all-day `20260908`.
 * All-day events are pinned to local midnight so they group onto the right day.
 */
function parseIcsDate(value: string): Date | undefined {
    const utc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
    if (utc) {
        const [, y, mo, d, h, mi, s] = utc;
        return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!));
    }
    const local = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
    if (local) {
        const [, y, mo, d, h, mi, s] = local;
        return new Date(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
    }
    const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (dateOnly) {
        const [, y, mo, d] = dateOnly;
        return new Date(+y!, +mo! - 1, +d!);
    }
    return undefined;
}

/**
 * Canvas writes summaries as `Assignment title [Course Name]`. Splitting that
 * back out is what makes the fallback output resemble the authenticated output.
 */
function splitSummary(summary: string): { title: string; course?: string } {
    const match = /^(.*)\s+\[([^\]]+)\]\s*$/.exec(summary);
    if (match?.[1] && match[2]) {
        return { title: match[1].trim(), course: match[2].trim() };
    }
    return { title: summary };
}

export function parseIcs(raw: string): IcsEvent[] {
    const events: IcsEvent[] = [];
    let current: Record<string, string> | undefined;

    for (const line of unfold(raw)) {
        if (line === 'BEGIN:VEVENT') {
            current = {};
            continue;
        }
        if (line === 'END:VEVENT') {
            if (current) {
                const start = parseIcsDate(current['DTSTART'] ?? '');
                const summary = unescapeText(current['SUMMARY'] ?? '').trim();
                if (start && summary) {
                    const { title, course } = splitSummary(summary);
                    const event: IcsEvent = { summary: title, start };
                    if (course) event.course = course;
                    if (current['URL']) event.url = current['URL'];
                    if (current['DESCRIPTION']) {
                        event.description = unescapeText(current['DESCRIPTION']);
                    }
                    events.push(event);
                }
            }
            current = undefined;
            continue;
        }
        if (!current) continue;

        // Property names may carry parameters, e.g. `DTSTART;VALUE=DATE:20260908`.
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        const rawName = line.slice(0, colon);
        const value = line.slice(colon + 1);
        const name = (rawName.split(';')[0] ?? '').toUpperCase();
        if (name) current[name] = value;
    }

    events.sort((a, b) => a.start.getTime() - b.start.getTime());
    return events;
}

/** Events falling inside `[from, to]`. */
export function eventsInWindow(events: IcsEvent[], from: Date, to: Date): IcsEvent[] {
    return events.filter(
        (event) => event.start.getTime() >= from.getTime() && event.start.getTime() <= to.getTime(),
    );
}
