# canvas-mcp

Ask Claude what you have due, what your professors posted, and how your grades are doing — without
opening Canvas.

It installs into **Claude Desktop as a single file**. No Node, no terminal, no config files, no
account to make. Setup is one download and one copy-paste.

**Read-only by construction**: it can look at your Canvas, never change it. It cannot submit, post,
or delete anything. [Details below.](#what-it-can-and-cannot-do)

## Install it

You need Claude Desktop and a Canvas login. Nothing else.

### 1. Download the extension

**[⬇ Download `canvas-ubc.mcpb`](https://github.com/jqyyy23/Canvas-LMS-MCP-/releases/latest)** —
grab the `.mcpb` file from the latest release (~4 MB).

Your browser may warn that it's an unusual file type. Keep it.

### 2. Open it

**Double-click the file**, or drag it onto the Claude Desktop window. Claude Desktop shows an install
dialog that lists the [eight tools](#what-it-can-do) it's adding, before you agree to anything.

If double-clicking does nothing, open Claude Desktop → **Settings → Extensions** and use the option
there to install an extension from a file.

### 3. Paste your Canvas session cookie

This is the only setup step, and the only fiddly one. It's how the extension proves it's you — it
borrows the login your browser already has.

1. Log into [canvas.ubc.ca](https://canvas.ubc.ca) in Chrome.
2. Press `F12`. A panel opens; click the **Application** tab at the top of it.
3. In that panel's left sidebar: **Storage → Cookies → `https://canvas.ubc.ca`**.
4. Find the row named **`canvas_session`**. Click it, then copy the whole **Value** — a long
   scramble of letters and numbers. Not the name, not the row.
5. Paste it into the **Canvas session cookie** field on the install screen and save.

Two notes:

- **It has to be the Application tab.** The cookie is `httpOnly`, so the Console tab genuinely
  cannot see it. If you got a short value or nothing at all, you copied the wrong thing.
- **Not at UBC?** Change **Canvas address** to your school's Canvas, and use that domain in step 3.
  If your school's cookie isn't called `canvas_session` (some call it `_normandy_session`), the
  extension can't reach it — you'd need to [run from source](#run-it-from-source) instead.

### 4. Add your calendar feed (optional, 30 seconds, worth it)

In Canvas, open **Calendar** and click **Calendar Feed** at the bottom right. Copy the whole URL into
**Calendar feed URL**.

That URL needs no login, so deadline questions keep answering during the hours between your session
expiring and you noticing. [How it degrades.](#the-calendar-feed-fallback)

### 5. Ask Claude

> catch me up on school

Others worth trying:

> what do I have due this week?
> did any of my professors post anything today?
> how am I doing in my courses?
> what exactly does the CPSC 210 assignment want?

Both settings fields are marked sensitive, so Claude Desktop keeps them in the macOS Keychain or
Windows Credential Manager rather than in a file on your disk.

## When Claude says your session expired

Canvas sessions last about a day, so this will happen roughly daily. The fix is 20 seconds:

1. Copy a fresh cookie — [the same steps as above](#3-paste-your-canvas-session-cookie).
2. **Settings → Extensions → Canvas (UBC)**, replace **Canvas session cookie**, save.

The extension restarts itself. Nothing else to do, and every tool tells you this when it happens, so
you don't have to remember it.

**Why can't it just stay logged in?** UBC logs you in through CWL single sign-on, and Canvas never
offers its own "Stay signed in" box under SSO. So there's a ~1-day cookie and no way to extend it.
That's your school's login, not something this extension can fix — which is why the calendar feed in
step 4 exists.

## If something looks wrong

Ask Claude to **check the Canvas connection** first (that runs `check_canvas_auth`), then:

| What you see | What's going on |
| --- | --- |
| "Session expired" on everything | Normal daily expiry. [Repaste the cookie.](#when-claude-says-your-session-expired) |
| Still expired right after repasting | The value went stale between copying and pasting, or you copied the cookie's **name** instead of its Value. Load Canvas in a fresh tab and copy again. |
| Deadlines answer but grades and announcements don't, with a warning banner | Your cookie is dead and you're being served from the calendar feed. Repaste the cookie. |
| Claude doesn't seem to have the tools at all | Check **Settings → Extensions** — the extension may be disabled, or Claude Desktop may need a restart. |
| 403 errors that aren't about rate limits | Your school has a bot filter in front of Canvas that the extension can't get past on its own. This needs [the source setup](#run-it-from-source). |

## What it can do

| Ask about | Tool |
| --- | --- |
| "Catch me up on school." Due soon + overdue + new announcements + newly graded, in one answer. **Best starting point.** | `get_daily_briefing` |
| "What do I have due?" Assignments, quizzes, discussions, events and to-dos, grouped by day, each marked submitted / not submitted / graded. | `get_upcoming_work` |
| "What did my professors post?" Recent announcements with body text. | `get_announcements` |
| "How am I doing?" Current grade per course, plus what was graded recently. | `get_grades` |
| One course in depth: syllabus, module progress, instructor contacts. | `get_course_detail` |
| One assignment in depth: full instructions, rubric, due date, your submission status. | `get_assignment_detail` |
| Your active courses and their ids. | `list_courses` |
| "Is the connection alive?" | `check_canvas_auth` |

## What it can and cannot do

- **It can only read.** The one piece of code that talks to Canvas hardcodes `method: 'GET'` and
  exposes no way to send anything else — there is no post/put/delete to reach for by accident. It
  sees exactly what you see when you log in, and it cannot submit an assignment, reply to a
  discussion, or change a setting.
- **Your cookie stays on your machine.** It goes from your browser into Claude Desktop's OS
  credential store and from there to your school's Canvas. Nowhere else.
- **Don't share the cookie with anyone**, including in a screenshot. For as long as it's alive it
  *is* your Canvas login.
- **Reading your own coursework is data you're already authorized to see**, but automated access may
  still fall under your school's acceptable-use policy. This is built to be a polite client —
  read-only, cached, low request volume. Keep it that way.

## The calendar-feed fallback

The session cookie is the fragile part, so there's a backstop. Canvas gives every user a personal
`.ics` calendar feed (**Calendar → Calendar Feed**) whose URL needs no cookie and no admin — the code
in the URL is itself the credential. With it configured, `get_upcoming_work` and `get_daily_briefing`
keep serving deadlines after the cookie dies, behind an explicit degraded-mode banner. Announcements
and grades genuinely can't work that way, and the banner says so rather than letting a thin answer
look complete.

---

# Developing

Everything below is for working on the extension, not for using it.

## Build the bundle

```bash
npm install
npm run pack        # -> canvas-ubc.mcpb, ~4 MB
```

That's the whole release process: hand the resulting file to a classmate, or
[publish it](#publish-a-release). `scripts/pack.mjs`:

1. Builds, then asks the compiled server for its real `tools/list` and fails if `manifest.json`
   disagrees — the install screen shows that list, and a stale entry there is a promise the server
   does not keep.
2. Stages `dist-mcpb/` from an explicit allowlist: `build/src`, `manifest.json`, `icon.png`, a
   trimmed `package.json` (Node needs `"type": "module"` next to the ESM output), and the production
   dependency tree resolved via `npm ls --omit=dev`. `build/scripts` is excluded — the cookie helper
   is a maintainer tool.
3. Walks the staged tree and refuses to pack if anything `.env`-, `.pem`-, or `.key`-shaped is in it.
4. Runs `mcpb validate`, then `mcpb pack`.

**Step 3 is the point of staging at all.** `.env` in this repo holds a live Canvas session cookie for
whoever runs the build; a bundle built by zipping the working directory would hand a classmate your
account. An allowlist cannot leak a file nobody remembered to deny. `.mcpbignore` covers the same
ground for anyone who runs `mcpb pack` here by hand.

The icon is generated too — `npm run icon` redraws the 512×512 `icon.png` from
`scripts/make-icon.mjs`, so it can be recoloured without a design tool.

## Publish a release

The download link at the top of this README points at the repo's latest GitHub Release, so publishing
is a tag:

```bash
# bump "version" in package.json AND manifest.json first — they must match the tag
git tag v0.1.1 && git push origin v0.1.1
```

`.github/workflows/release.yml` builds the bundle on a clean checkout, refuses to continue if the tag
and the two version fields disagree, and attaches `canvas-ubc.mcpb` to the release. Running it
manually (**Actions → Release → Run workflow**) produces the same bundle as a downloadable build
artifact without cutting a release.

Building on a runner is also the safer default: `npm run pack` guards against shipping credentials,
but a runner has no `.env` to leak in the first place.

## Run it from source

The development loop, and the escape hatch for anything the extension's three settings fields can't
express (a differently-named session cookie, a Cloudflare `cf_clearance`, a personal access token).

```bash
npm install
cp .env.example .env     # then fill it in
npm run build
```

| Variable | Required? | What it is |
| --- | --- | --- |
| `CANVAS_BASE_URL` | **yes** | Your Canvas origin, https, e.g. `https://canvas.ubc.ca` |
| `CANVAS_SESSION_COOKIE` | **yes** | The cookie value, copied as in [step 3](#3-paste-your-canvas-session-cookie) |
| `CANVAS_SESSION_COOKIE_NAME` | if not `canvas_session` | The cookie's name on your install. Upstream Canvas ships `_normandy_session`; installs rename it. Canvas silently ignores a name it doesn't recognize, so a mismatch looks exactly like an expired session — `check_canvas_auth` prints the name in use |
| `CANVAS_ICS_FEED_URL` | recommended | Canvas → **Calendar → Calendar Feed**. Keeps deadlines working when the cookie dies |
| `CANVAS_REMEMBER_COOKIE` | optional | A `pseudonym_credentials` cookie, if your Canvas sets one. Stretches refreshes to ~2 weeks. **Does not exist under SSO** |
| `CANVAS_EXTRA_COOKIES` | rarely | Raw `name=value; name2=value2`, e.g. `cf_clearance=…` behind Cloudflare. That one is tied to your IP and User-Agent, so it needs recopying more often than the session cookie |
| `CANVAS_USER_AGENT` | rarely | Overrides the default Chrome User-Agent |
| `CANVAS_ACCESS_TOKEN` | optional | A Canvas personal access token, if your school enables them. Takes priority over cookies and removes the expiry problem entirely |

`.env` is gitignored. Keep it that way — it holds a live credential for your Canvas account.

### Verify it works

```bash
npm run smoke
```

Talks to Canvas directly with no MCP layer involved, and prints your name, your courses, and your
next few deadlines. **Run this first whenever something is wrong** — a bad cookie or a school that
blocks session-authenticated API calls fails here in seconds with a clear reason, instead of showing
up as a mysteriously empty tool result.

### Connect it to Claude Code

The repo ships a `.mcp.json`, so Claude Code picks the server up when you open this folder. Two
things to know:

- **Build before you connect.** `.mcp.json` runs `build/src/index.js`, which doesn't exist until
  `npm run build`.
- **The server exits at startup if `.env` has no credentials**, rather than serving tools that can
  only fail. So in a fresh clone the order matters: fill in `.env`, build, *then* start or reconnect
  Claude Code. If you were already running: `/mcp` → **canvas** → **Reconnect**.

Confirm with `check_canvas_auth`. To poke at the tools without Claude: `npm run inspect` (MCP
Inspector).

### Point Claude Desktop at the checkout

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

In `claude_desktop_config.json`. This is for testing changes against Desktop; for anyone not editing
the code, the bundle needs no paths, no Node, and no `.env`.

### Refresh the cookie from source

```bash
npm run cookie              # reads the value straight from your clipboard
npm run cookie -- <value>   # or pass it explicitly
```

Rewrites just the one line in `.env` (comments and your other settings survive), then verifies the
cookie against Canvas immediately, so you find out it worked here rather than from a failing tool
call later.

Then make the client pick it up:

- **If the canvas server is still connected**, you're done — it re-reads `.env` on the next
  authentication failure and retries once with the new credential. (Only when the value actually
  changed, so a genuinely dead cookie still fails fast instead of looping.)
- **If the server is disconnected or its tools are missing**, its process is gone and no amount of
  `.env` editing will reach it. Reload the tools: `/mcp` → **canvas** → **Reconnect**.

`.claude/skills/canvas-cookie/SKILL.md` is a project skill that walks Claude through that whole
sequence, ending with `check_canvas_auth` — the step that's easy to skip by hand, since a refreshed
`.env` does nothing for a server process that already exited.

## Why it authenticates with a cookie

Canvas's normal API auth is a personal access token, but many schools disable self-service token
generation for students, and OAuth2 developer keys need an admin too.

Canvas's own web UI calls `/api/v1` using your ordinary session cookie, and the server accepts that
as a first-class auth path — `load_user` in `lib/authentication_methods.rb` tries token auth first and
then falls back to `PseudonymSession.find_with_validation`. So this server sends the same cookie your
browser does.

Two consequences worth knowing:

- **Read-only is enforced structurally.** `CanvasClient` exposes one request primitive that hardcodes
  `method: 'GET'`, and no caller can pass a method through. This also means no CSRF token is ever
  needed, since Rails only verifies CSRF on non-GET requests.
- **The cookie has to be re-pasted periodically** — about daily under SSO, or every two weeks with a
  `pseudonym_credentials` cookie. When it lapses, every tool returns step-by-step refresh
  instructions rather than an error, and deadline tools fall back to the calendar feed.

## What differs inside the bundle

The extension gets its settings from `manifest.json`'s `user_config`, which Claude Desktop renders as
a form and injects as environment variables. Two consequences the code accounts for:

- **There is no `.env` and no terminal**, so every "here is how to fix this" message forks on
  `isBundleInstall()` (set by `CANVAS_INSTALL=mcpb` in the manifest) and tells extension users to edit
  the settings field instead. Telling someone to edit a file they cannot see is the worst thing these
  messages could do. The hot-reload in `readEnvFile` simply finds nothing and the server fails fast,
  which is correct: Claude Desktop restarts it on a settings change anyway.
- **A blank optional field can arrive as the literal string `${user_config.ics_feed_url}`**, so
  `clean()` in `config.ts` reads an unsubstituted placeholder as empty. Without that, an untouched
  calendar-feed box becomes a garbage URL that fails deep inside a request.

`CANVAS_ACCESS_TOKEN`, `CANVAS_REMEMBER_COOKIE`, `CANVAS_EXTRA_COOKIES` and
`CANVAS_SESSION_COOKIE_NAME` are deliberately not in `user_config`: none apply at UBC, and every
extra field in that form is one more thing a student has to decide about. They still work from a
source checkout, which is what the [troubleshooting table](#if-something-looks-wrong) points at for
the rare install that needs them.

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
  refresh-cookie.ts     one-command cookie refresh, verified against Canvas
  smoke.ts              direct connectivity check, no MCP
  pack.mjs              builds and validates the .mcpb bundle
  make-icon.mjs         redraws icon.png
manifest.json           the extension: settings form, tool list, entry point
.github/workflows/
  release.yml           tag -> bundle -> GitHub Release
.claude/skills/
  canvas-cookie/        project skill: refresh the cookie and reload the tools
```

## Notes

- Built on `@modelcontextprotocol/server` v2 (`serveStdio`), not the older v1
  `@modelcontextprotocol/sdk` monolith — most examples online still show v1.
- Requires Node ≥ 20; no `dotenv`, Node loads `.env` itself.
- Tools return compact formatted text rather than raw JSON. That's the main lever on both token cost
  and answer quality.

## Not included (deliberately)

Writing anything to Canvas, OAuth, remote hosting as a claude.ai connector, multi-user support.
