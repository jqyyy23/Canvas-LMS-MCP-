/**
 * Standalone connectivity check — no MCP layer involved.
 *
 * Run this first whenever something is wrong. If the cookie is bad or your
 * institution blocks session-authenticated API calls, it fails here in seconds
 * with a clear reason, instead of surfacing as a mysteriously empty tool result.
 *
 *   npm run smoke
 */

import { CanvasAuthError, CanvasClient } from '../src/canvas/client.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { getActiveCourses, getAnnouncements, getPlannerItems, getSelf } from '../src/canvas/queries.js';
import { courseLabel } from '../src/canvas/queries.js';
import { formatDateTime, idToString } from '../src/format.js';

async function main(): Promise<void> {
    let client: CanvasClient;
    try {
        client = new CanvasClient(loadConfig());
    } catch (err) {
        if (err instanceof ConfigError) {
            console.error(`\n❌ Configuration error:\n\n${err.message}\n`);
            process.exit(1);
        }
        throw err;
    }

    console.log(`Canvas host : ${client.baseUrl}`);
    console.log(`Auth method : ${client.authMode}`);
    console.log('');

    // 1. Identity — the cheapest possible proof the credentials work.
    const self = await getSelf(client);
    console.log(
        `✅ Authenticated as ${self.name ?? self.short_name ?? 'unknown'} (id ${idToString(self.id)})`,
    );

    // 2. Courses — proves enrollment data is readable, and is needed by step 4.
    const courses = await getActiveCourses(client);
    console.log(`✅ ${courses.length} active course(s):`);
    for (const course of courses) {
        console.log(`   - ${courseLabel(course)} [id ${idToString(course.id)}]`);
    }

    // 3. Planner — the endpoint the flagship tool depends on.
    const now = new Date();
    const items = await getPlannerItems(client, now, new Date(now.getTime() + 14 * 86_400_000));
    console.log(`✅ ${items.length} planner item(s) in the next 14 days. Next 5:`);
    for (const item of items.slice(0, 5)) {
        const title = item.plannable?.title ?? item.plannable?.name ?? '(untitled)';
        console.log(`   - ${title} — ${formatDateTime(item.plannable_date)} [${item.context_name ?? '?'}]`);
    }

    // 4. Announcements — the one endpoint that needs context_codes[], so it is
    //    worth exercising separately; a permissions problem shows up only here.
    if (courses.length > 0) {
        const start = new Date(now.getTime() - 14 * 86_400_000);
        const announcements = await getAnnouncements(client, courses, start, now);
        console.log(`✅ ${announcements.length} announcement(s) in the last 14 days.`);
    }

    console.log('\nAll checks passed. The MCP server should work.');
}

main().catch((err: unknown) => {
    if (err instanceof CanvasAuthError) {
        console.error(`\n❌ ${err.message}\n`);
    } else {
        console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exit(1);
});
