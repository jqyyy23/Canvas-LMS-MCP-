/**
 * Tool plumbing: result shapes and the error boundary every tool sits behind.
 */

import type { CallToolResult } from '@modelcontextprotocol/server';
import { CanvasAuthError, CanvasRequestError } from '../canvas/client.js';
import { ConfigError } from '../config.js';

/**
 * The SDK's result type carries an index signature, which a locally declared
 * `interface` would not satisfy — use theirs rather than redeclaring it.
 */
export type ToolTextResult = CallToolResult;

export function textResult(text: string): ToolTextResult {
    return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): ToolTextResult {
    return { content: [{ type: 'text', text }], isError: true };
}

/**
 * Wraps a tool body so failures come back as readable text rather than a
 * protocol-level exception. An expired cookie is the expected steady-state
 * failure here, not an exceptional one, so it deserves an answer that tells you
 * how to fix it instead of a stack trace.
 *
 * `onAuthFailure` lets a tool serve degraded data (the token-free calendar feed)
 * instead of failing outright. Its result is returned as a success, because it
 * carries real data — the degraded banner inside it conveys the caveat.
 */
export async function guard(
    run: () => Promise<string>,
    onAuthFailure?: () => Promise<string | undefined>,
): Promise<ToolTextResult> {
    try {
        return textResult(await run());
    } catch (err) {
        if (err instanceof CanvasAuthError) {
            if (onAuthFailure) {
                const degraded = await onAuthFailure().catch(() => undefined);
                if (degraded) return textResult(degraded);
            }
            return errorResult(err.message);
        }
        if (err instanceof ConfigError) {
            return errorResult(`Configuration problem: ${err.message}`);
        }
        if (err instanceof CanvasRequestError) {
            return errorResult(`Canvas request failed: ${err.message}`);
        }
        return errorResult(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/** Read-only marker applied to every tool in this server. */
export const READ_ONLY = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
} as const;
