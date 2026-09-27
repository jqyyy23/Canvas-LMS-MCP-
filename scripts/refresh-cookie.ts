/**
 * One-command cookie refresh.
 *
 *   npm run cookie          # reads the value from your clipboard
 *   npm run cookie -- <val> # or pass it explicitly
 *
 * On an SSO-backed Canvas (UBC's CWL, for one) the session cookie expires daily
 * and there is no "stay signed in" option to extend it, so this path gets walked
 * often. It writes `.env` for you and verifies the cookie against Canvas
 * immediately, so you learn it worked here rather than from a failing tool call.
 *
 * A running MCP server re-reads `.env` on its next authentication failure, so no
 * restart is needed. A server that already exited — which is what happens in a
 * fresh clone, where there is no `.env` at launch — cannot, so the closing
 * message says to reload the client's tools in that case rather than claiming
 * the refresh is always self-applying.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { CanvasClient } from '../src/canvas/client.js';
import { ConfigError, envFilePath, loadConfig, readEnvFile } from '../src/config.js';
import { getSelf } from '../src/canvas/queries.js';
import { idToString } from '../src/format.js';

/** Reads the clipboard without adding a dependency. */
function readClipboard(): string {
    try {
        if (process.platform === 'win32') {
            return execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard'], {
                encoding: 'utf8',
            });
        }
        if (process.platform === 'darwin') {
            return execFileSync('pbpaste', { encoding: 'utf8' });
        }
        return execFileSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf8' });
    } catch {
        return '';
    }
}

/**
 * Replaces one key in `.env`, preserving comments, ordering, and every other
 * value — this file is hand-maintained, so rewriting it wholesale would be rude.
 */
function setEnvValue(path: string, key: string, value: string): void {
    let lines: string[];
    try {
        lines = readFileSync(path, 'utf8').split(/\r?\n/);
    } catch {
        throw new ConfigError(
            `No .env found at ${path}.\nCreate it first:  cp .env.example .env`,
        );
    }

    let replaced = false;
    const updated = lines.map((line) => {
        if (!replaced && new RegExp(`^\\s*${key}\\s*=`).test(line)) {
            replaced = true;
            return `${key}=${value}`;
        }
        return line;
    });
    if (!replaced) updated.push(`${key}=${value}`);

    writeFileSync(path, updated.join('\n'), 'utf8');
}

async function main(): Promise<void> {
    const fromArg = process.argv.slice(2).join(' ').trim();
    const raw = (fromArg || readClipboard()).trim();

    if (!raw) {
        console.error(
            '❌ No cookie value found.\n\n' +
                'Copy the session cookie first: Canvas in Chrome > F12 > Application >\n' +
                'Cookies > your Canvas domain > copy the Value of `canvas_session`.\n' +
                'Then run this again, or pass it directly:  npm run cookie -- <value>',
        );
        process.exit(1);
    }

    // A pasted cookie is long and opaque; a stray UI string is not. Catching that
    // here beats a confusing 401 later.
    if (raw.length < 40 || /\s/.test(raw.replace(/^[^=]*=/, ''))) {
        console.error(
            `❌ That does not look like a session cookie (${raw.length} chars, contains whitespace).\n` +
                'Make sure you copied the cookie **Value** column, not its name or the whole row.',
        );
        process.exit(1);
    }

    const path = envFilePath();
    setEnvValue(path, 'CANVAS_SESSION_COOKIE', raw);
    console.log(`✅ Wrote CANVAS_SESSION_COOKIE (${raw.length} chars) to ${path}`);

    // Verify against Canvas, so success here means success in the tools.
    let client: CanvasClient;
    try {
        client = new CanvasClient(loadConfig({ ...process.env, ...readEnvFile(path) }));
    } catch (err) {
        console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    try {
        const self = await getSelf(client);
        console.log(
            `✅ Verified — signed in as ${self.name ?? self.short_name ?? 'unknown'} (id ${idToString(self.id)})`,
        );
        console.log(
            '\nA running MCP server picks this up on its next call — no restart needed.\n' +
                'If the Canvas tools are missing or still report an expired session, its\n' +
                'process exited earlier and the client is holding a dead connection: reload\n' +
                'the tools (in Claude Code, /mcp > canvas > Reconnect), then run\n' +
                'check_canvas_auth.',
        );
    } catch (err) {
        console.error(`\n❌ Canvas rejected it:\n${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

main().catch((err: unknown) => {
    console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
