/**
 * Canvas returns rich-text fields (announcement bodies, assignment descriptions,
 * syllabi) as HTML. Feeding raw HTML to a model wastes tokens and reads badly, so
 * everything user-facing goes through here first.
 *
 * turndown bundles its own DOM implementation, so this works in plain Node with
 * no jsdom.
 */

import TurndownService from 'turndown';

const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
});

// Canvas wraps a lot of content in layout tables and iframes that carry no
// information once flattened to text.
turndown.remove(['style', 'script', 'iframe']);

/** Converts a Canvas HTML fragment to markdown-ish plain text. */
export function htmlToText(html: string | null | undefined): string {
    if (!html) return '';
    let text: string;
    try {
        text = turndown.turndown(html);
    } catch {
        // Never let a malformed body take down a whole tool call.
        text = html.replace(/<[^>]+>/g, ' ');
    }
    // Collapse the long runs of blank lines Canvas's editor tends to emit.
    return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Truncates on a word boundary and says so. The explicit note matters: it tells
 * the model the text was cut rather than letting it assume it saw everything.
 */
export function truncate(text: string, maxChars: number, hint?: string): string {
    if (text.length <= maxChars) return text;
    const cut = text.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    const body = (lastSpace > maxChars * 0.8 ? cut.slice(0, lastSpace) : cut).trimEnd();
    const suffix = hint ? ` (truncated — ${hint})` : ' (truncated)';
    return `${body}…${suffix}`;
}

/** Convert then truncate, the combination almost every caller wants. */
export function htmlSummary(html: string | null | undefined, maxChars: number, hint?: string): string {
    return truncate(htmlToText(html), maxChars, hint);
}
