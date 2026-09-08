# canvas-mcp

A read-only [MCP](https://modelcontextprotocol.io) server for Canvas LMS, so Claude can pull your
deadlines, announcements, and grades in the same conversation where it checks your email — instead
of you checking Canvas on a separate site.

**Read-only**: it can look at Canvas, never change it. Ships two ways — as a one-file
[`.mcpb` extension](#install-it-students) for classmates on Claude Desktop, and as a
[source checkout](#developing-from-source) for Claude Code.

## What it can do

| Tool | What it answers |
| --- | --- |
| `get_daily_briefing` | "Catch me up on school." Due soon + overdue + new announcements + newly graded, in one call. **Start here.** |
| `get_upcoming_work` | "What do I have due?" Assignments, quizzes, discussions, events and to-dos, grouped by day, each marked submitted / not submitted / graded. |
| `get_announcements` | "What did my professors post?" Recent announcements with body text. |
| `get_grades` | "How am I doing?" Current grade per course, plus what was graded recently. |
| `get_course_detail` | Syllabus, module progress, and instructor contacts for one course. |
| `get_assignment_detail` | Full instructions, rubric, due date, and your submission status for one assignment. |
| `list_courses` | Your active courses and their ids. |
| `check_canvas_auth` | "Is the connection alive?" Run this first when something looks wrong. |

## Install it (students)

You need Claude Desktop and a UBC Canvas login. You do **not** need Node, git, or a terminal —
Claude Desktop ships its own Node runtime and the extension carries its own dependencies.

1. Get `canvas-ubc.mcpb` (ask whoever sent you here, or build it yourself — see
   [Building the bundle](#building-the-bundle)).
2. Double-click it, or drag it onto the Claude Desktop window. Either opens the install screen,
   which lists the eight tools above before you agree to anything.
3. Fill in the one required field, **Canvas session cookie**:
   - Log into [canvas.ubc.ca](https://canvas.ubc.ca) in Chrome.
   - Press `F12`, open the **Application** tab.
   - **Storage → Cookies → `https://canvas.ubc.ca`**.
   - Copy the **Value** of the row named `canvas_session` and paste it in.
4. Optional but worth 30 seconds: in Canvas open **Calendar → Calendar Feed** (bottom right) and
   paste that whole URL into **Calendar feed URL**. It keeps deadline questions answering during
   the hours between your session expiring and you noticing.
5. Ask Claude *"catch me up on school."*

Both fields are marked sensitive in the manifest, so Claude Desktop stores them in Windows
Credential Manager or the macOS Keychain rather than in a file on disk.

### When it says the session expired

UBC logs you in through CWL single sign-on. Canvas never offers its own "Stay signed in" box under
SSO, so **the session cookie lasts about a day and there is no way to extend it.** This is a
property of UBC's login, not something the extension can fix.

Refreshing is the same paste as step 3: **Settings → Extensions → Canvas (UBC)**, replace the
cookie, save. The extension restarts itself. Every tool tells you this when it happens, so you
never have to remember it.

## Why it authenticates with a cookie

Canvas's normal API auth is a personal access token, but many schools disable self-service token
generation for students, and OAuth2 developer keys need an admin too.

Canvas's own web UI calls `/api/v1` using your ordinary session cookie, and the server accepts that
as a first-class auth path — `load_user` in `lib/authentication_methods.rb` tries token auth first
and then falls back to `PseudonymSession.find_with_validation`. So this server sends the same
cookie your browser does.

Two consequences worth knowing:

- **Read-only is enforced structurally.** The `CanvasClient` class exposes one request primitive
  that hardcodes `method: 'GET'`. There is no `post`/`put`/`delete` to reach for by accident. This
  also means no CSRF token is ever needed, since Rails only verifies CSRF on non-GET requests.
- **You will re-paste the cookie periodically** — about daily under SSO, or every two weeks if your
  Canvas offers a "Stay signed in" cookie. `npm run cookie` makes that one command, and the server
  picks up the new value without restarting. When it does lapse, every tool returns step-by-step
  refresh instructions rather than an error, and deadline tools fall back to the calendar feed.
- **The cookie's name is per-institution**, so it's configurable. See below.

One caution: reading your own coursework is data you're already authorized to see, but automated
access may still fall under your institution's acceptable-use policy. This server is built to be a
polite client — GET-only, cached, low request volume. Keep it that way.

## Developing from source

```bash
npm install
cp .env.example .env    # then fill it in
npm run build
```

### Getting the cookie

1. Log into Canvas in Chrome.
2. Press `F12` and open the **Application** tab.
3. **Storage → Cookies → your Canvas domain**.
4. Copy the **Value** of `canvas_session` into `CANVAS_SESSION_COOKIE` in `.env`.

The cookie is `httpOnly`, so `document.cookie` in the console will **not** show it. The Application
tab is the only way to read it.

**The cookie name varies by institution.** `canvas.ubc.ca` calls it `canvas_session`; upstream
open-source Canvas ships `_normandy_session`; other installs rename it again. Whatever large
`httpOnly` cookie your Canvas domain sets is the right one — set `CANVAS_SESSION_COOKIE_NAME` to
match. This matters because Canvas silently ignores a cookie name it doesn't recognize, so a
mismatch is indistinguishable from an expired session. `check_canvas_auth` prints the name in use.

If a `pseudonym_credentials` cookie exists, copy it into `CANVAS_REMEMBER_COOKIE` too — it
stretches the refresh interval to ~2 weeks. **It won't exist if your school uses single sign-on**
(UBC's CWL, for instance): Canvas delegates login to the campus identity provider, so its own
"Stay signed in" box never appears. In that case you're on the ~1-day cookie with no way to extend
it, which is what the refresh command below is for.

### Refreshing the cookie

```bash
npm run cookie          # reads the value straight from your clipboard
npm run cookie -- <value>
```

This rewrites just the one line in `.env` (comments and your other settings survive), then verifies
the cookie against Canvas immediately, so you find out it worked here rather than from a failing
tool call later.

**No restart needed.** The server re-reads `.env` whenever a request fails authentication and
retries once with the new credential. It only retries when the value actually changed, so a
genuinely dead cookie still fails fast instead of looping.

Under SSO the refresh is usually quick: your campus session outlives the Canvas one, so opening
Canvas is a silent redirect rather than a fresh password prompt.

### If your Canvas is behind Cloudflare

Some institutions (UBC included) front Canvas with Cloudflare. If you get 403s that aren't rate
limits, copy the `cf_clearance` cookie into `CANVAS_EXTRA_COOKIES` as
`cf_clearance=<value>`. The server already sends a browser User-Agent by default, since it is
carrying a browser session cookie; `CANVAS_USER_AGENT` overrides that if needed.

### Verify it works

```bash
npm run smoke
```

This talks to Canvas directly with no MCP layer involved. It prints your name, your courses, and
your next few deadlines. **Run this first whenever something is wrong** — if the cookie is bad, or
your institution blocks session-authenticated API calls, it fails here in seconds with a clear
reason instead of showing up as a mysteriously empty tool result.

### Connect it to Claude

The repo ships a `.mcp.json`, so Claude Code picks the server up automatically when you open this
folder. Restart Claude Code after the first build.

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": [
        "--env-file-if-exists=C:\\path\\to\\Canvas MCP\\.env",
        "C:\\path\\to\\Canvas MCP\\build\\src\\index.js"
      ]
    }
  }
}
```

Pointing Claude Desktop at a checkout like this is the development loop. For anyone who is not
editing the code, build the bundle instead — it needs no paths, no Node, and no `.env`.

To poke at the tools directly:

```bash
npm run inspect     # opens the MCP Inspector
```

### Building the bundle

```bash
npm run pack        # -> canvas-ubc.mcpb, ~4 MB
```

That is the whole release process; hand the resulting file to a classmate. `scripts/pack.mjs`:

1. Builds, then asks the compiled server for its real `tools/list` and fails if `manifest.json`
   disagrees — the install screen shows that list, and a stale entry there is a promise the
   server does not keep.
2. Stages `dist-mcpb/` from an explicit allowlist: `build/src`, `manifest.json`, `icon.png`, a
   trimmed `package.json` (Node needs `"type": "module"` next to the ESM output), and the
   production dependency tree resolved via `npm ls --omit=dev`. `build/scripts` is excluded — the
   cookie helper is a maintainer tool.
3. Walks the staged tree and refuses to pack if anything `.env`-, `.pem`-, or `.key`-shaped is in
   it.
4. Runs `mcpb validate`, then `mcpb pack`.

**Step 3 is the point of staging at all.** `.env` in this repo holds a live Canvas session cookie
for whoever runs the build; a bundle built by zipping the working directory would hand a classmate
your account. An allowlist cannot leak a file nobody remembered to deny. `.mcpbignore` covers the
same ground for anyone who runs `mcpb pack` here by hand.

The icon is generated too — `npm run icon` redraws `icon.png` from `scripts/make-icon.mjs`, so it
can be recoloured without a design tool.

### What differs inside the bundle

The extension gets its settings from `manifest.json`'s `user_config`, which Claude Desktop renders
as a form and injects as environment variables. Two consequences the code accounts for:

- **There is no `.env` and no terminal**, so every "here is how to fix this" message forks on
  `isBundleInstall()` (set by `CANVAS_INSTALL=mcpb` in the manifest) and tells extension users to
  edit the settings field instead. Telling someone to edit a file they cannot see is the worst
  thing these messages could do. The hot-reload in `readEnvFile` simply finds nothing and the
  server fails fast, which is correct: Claude Desktop restarts it on a settings change anyway.
- **A blank optional field can arrive as the literal string `${user_config.ics_feed_url}`**, so
  `clean()` in `config.ts` reads an unsubstituted placeholder as empty. Without that, an untouched
  calendar-feed box becomes a garbage URL that fails deep inside a request.

`CANVAS_ACCESS_TOKEN`, `CANVAS_REMEMBER_COOKIE`, and `CANVAS_EXTRA_COOKIES` are deliberately not in
`user_config`: none apply at UBC, and every extra field in that form is one more thing a student
has to decide about. They still work from a source checkout.

## The calendar-feed fallback

The session cookie is the fragile part, so there's a backstop. Canvas gives every user a personal
`.ics` calendar feed (**Calendar → Calendar Feed**) whose URL needs no cookie and no admin — the
code in the URL is itself the credential. Put it in `CANVAS_ICS_FEED_URL` and, when the cookie
expires, `get_upcoming_work` and `get_daily_briefing` serve deadlines from the feed with an explicit
degraded-mode banner. Announcements and grades genuinely can't work that way, and the banner says so
rather than letting a thin answer look complete.

## Layout

```text
src/
  index.ts              stdio entrypoint
  config.ts             env parsing and validation
  format.ts             shared text formatting (relative dates, scores, grouping)
  canvas/
    client.ts           the only module that talks to Canvas: GET-only, paginated,
                        retrying, cookie-rotating, with typed auth errors
    queries.ts          shared reads, cached so the briefing composes cheaply
    types.ts            Canvas object shapes
    html.ts             HTML → markdown (Canvas returns rich text everywhere)
    ics.ts              minimal iCalendar parser for the fallback
  tools/                one module per tool group, all read-only
scripts/
  smoke.ts              direct connectivity check, no MCP
```

## Notes

- Built on `@modelcontextprotocol/server` v2 (`serveStdio`), not the older v1
  `@modelcontextprotocol/sdk` monolith — most examples online still show v1.
- Requires Node ≥ 20; no `dotenv`, Node loads `.env` itself.
- Tools return compact formatted text rather than raw JSON. That's the main lever on both token
  cost and answer quality.

## Not included (deliberately)

Writing anything to Canvas, OAuth, remote hosting as a claude.ai connector, multi-user support.
