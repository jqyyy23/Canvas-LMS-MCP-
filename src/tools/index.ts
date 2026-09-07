import type { McpServer } from '@modelcontextprotocol/server';
import { CanvasClient } from '../canvas/client.js';
import { registerAnnouncementTools } from './announcements.js';
import { registerBriefingTool } from './briefing.js';
import { registerCourseTools } from './courses.js';
import { registerDetailTools } from './detail.js';
import { registerGradeTools } from './grades.js';
import { registerWorkTools } from './work.js';

/** Registers every tool. All are read-only; nothing here writes to Canvas. */
export function registerAllTools(server: McpServer, client: CanvasClient): void {
    registerCourseTools(server, client); // check_canvas_auth, list_courses
    registerWorkTools(server, client); // get_upcoming_work
    registerAnnouncementTools(server, client); // get_announcements
    registerGradeTools(server, client); // get_grades
    registerDetailTools(server, client); // get_course_detail, get_assignment_detail
    registerBriefingTool(server, client); // get_daily_briefing
}
