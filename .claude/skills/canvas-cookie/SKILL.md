---
name: canvas-cookie
description: Refresh the Canvas session cookie for this repo's MCP server, then force the client to reload its tools so the new cookie is actually used. Use when a canvas tool reports an expired session, "Canvas rejected the credentials", or 401; when the `canvas` MCP server failed to connect (CONNECTION_CLOSED) or its `mcp__canvas__*` tools are missing; or when setting up `.env` in a fresh clone or a new cloud session.
---

# Refresh the Canvas session cookie

Canvas sessions here last about a day (SSO gives no "stay signed in" option), so this path gets
walked often. It has two halves, and **the second one is the half people skip**: writing a fresh
cookie into `.env` does nothing if the MCP client is holding a server process that already exited.
Always finish by reloading the tools and confirming with `check_canvas_auth`.

## 1. Preflight

```bash
test -d build/src || npm run build        # .mcp.json runs build/src/index.js
test -f .env || cp .env.example .env      # then make sure CANVAS_BASE_URL is set
```

If `.env` is missing `CANVAS_BASE_URL`, set it before step 2 — `npm run cookie` verifies against
Canvas and needs to know which Canvas.

## 2. Write and verify the cookie

Ask the user for the cookie value if you don't have it, pointing them at
**[step 3 of the README](../../../README.md#3-paste-your-canvas-session-cookie)**: Canvas in Chrome → `F12` →
**Application** → **Storage → Cookies → your Canvas domain** → copy the **Value** of
`canvas_session`. It's `httpOnly`, so the Console can't show it.

```bash
npm run cookie -- '<value>'   # quote it; or bare `npm run cookie` to read the clipboard (local only)
```

Expect two lines: `✅ Wrote CANVAS_SESSION_COOKIE (… chars)` and
`✅ Verified — signed in as <name>`. The script rewrites only that one line of `.env`, so comments
and other settings survive.

If it fails:

- **"does not look like a session cookie"** — they copied the name or the whole row, not the Value.
- **Canvas rejected it** — either the value is already stale (copy it again from a tab you just
  loaded), or the cookie name is wrong for this institution. `canvas.ubc.ca` uses `canvas_session`;
  upstream Canvas uses `_normandy_session`. Set `CANVAS_SESSION_COOKIE_NAME` to match. A wrong name
  is indistinguishable from an expired session, so check it early.

Never echo the cookie value back into the conversation, into a commit, or into a file other than
`.env` (which is gitignored).

## 3. Force the tools to reload

Do this every time, even when step 2 printed `✅ Verified`.

Why: a live server re-reads `.env` on its next auth failure and retries once, so it recovers on its
own. But `src/index.ts` **exits at startup** when `.env` has no usable credentials — the deliberate
"fail fast rather than serve tools that can only fail" choice. In a fresh clone or a new cloud
session there is no `.env` at launch, so the server is already dead and the client has a stale,
failed connection. No amount of `.env` editing reaches a process that isn't running.

Work through these in order and stop as soon as `check_canvas_auth` answers:

1. Call `mcp__canvas__check_canvas_auth`. If it reports who you're signed in as, you're done.
2. If that tool isn't in your toolset, re-resolve it (`ToolSearch` with
   `select:mcp__canvas__check_canvas_auth`) and call it again.
3. If it's still missing or the call fails with a connection error, the server needs a reconnect and
   you cannot do it yourself. Ask the user, in one line, to reload the MCP tools:
   - **Claude Code (terminal):** `/mcp` → **canvas** → **Reconnect**.
   - **Claude Desktop / web:** ask to reload the MCP tools (this is what worked before), or restart
     the client.
   - **The `.mcpb` extension:** re-saving the cookie field in **Settings → Extensions → Canvas
     (UBC)** restarts the server by itself — no reconnect needed.

   Then call `mcp__canvas__check_canvas_auth` again.

## 4. Confirm, then report

Report back the things that prove it worked, and nothing more: the signed-in name, the auth mode,
the cookie name in use, and whether a reconnect was needed. Then carry on with whatever the user was
actually trying to do.

If `check_canvas_auth` still fails after a reconnect, drop out of MCP entirely:

```bash
npm run smoke     # talks to Canvas directly — no MCP, no client, no cache
```

A failure there is a Canvas/cookie/network problem, not a reload problem. A success there with tools
still failing means the client is still on the old process — reconnect again.

## Don't

- Don't tell the user "no restart needed" without checking. That's only true while the server
  process is alive.
- Don't edit `.mcp.json` to try to trigger a reconnect; editing it doesn't reload anything.
- Don't commit `.env`, and don't put a cookie value in a commit message, a log, or a PR body.
