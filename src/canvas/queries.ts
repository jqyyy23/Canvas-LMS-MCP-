/**
 * Shared read queries.
 *
 * Anything more than one tool needs lives here, so the course list is fetched
 * once and reused (get_daily_briefing would otherwise refetch it four times).
 */

import { CanvasClient } from './client.js';
import type {
    CanvasAnnouncement,
    CanvasAssignment,
    CanvasCourse,
    CanvasEnrollment,
    CanvasPlannerItem,
    CanvasUser,
} from './types.js';
import { idToString } from '../format.js';

const COURSES_TTL_MS = 10 * 60_000;
const SHORT_TTL_MS = 60_000;

/** The current user. Also the cheapest possible auth check. */
export function getSelf(client: CanvasClient): Promise<CanvasUser> {
    return client.cached('self', COURSES_TTL_MS, () => client.get<CanvasUser>('/api/v1/users/self'));
}

/**
 * Active courses for the current user.
 *
 * `enrollment_state=active` alone still returns courses from past terms whose
 * enrollment was never concluded, so results are additionally filtered to those
 * that are `available` and not date-restricted.
 */
export function getActiveCourses(client: CanvasClient): Promise<CanvasCourse[]> {
    return client.cached('courses:active', COURSES_TTL_MS, async () => {
        const courses = await client.getAll<CanvasCourse>('/api/v1/courses', {
            enrollment_state: 'active',
            'include[]': ['term', 'total_scores', 'favorites'],
            state: ['available'],
        });
        return courses.filter((course) => !course.access_restricted_by_date);
    });
}

/**
 * Courses you are enrolled in that Canvas will not yet show you.
 *
 * Before a term opens (or before an instructor publishes), Canvas returns the
 * course as `{ id, access_restricted_by_date: true }` and nothing else — no
 * name, term, or dates. They are unusable, but counting them matters: at the
 * start of a term "you have 6 courses" is alarming when you enrolled in 28, and
 * this is the difference between "the tool is broken" and "your classes haven't
 * opened yet".
 */
export function getPendingCourseCount(client: CanvasClient): Promise<number> {
    return client.cached('courses:pending', COURSES_TTL_MS, async () => {
        const all = await client.getAll<CanvasCourse>('/api/v1/courses');
        return all.filter((course) => course.access_restricted_by_date).length;
    });
}

/** Display name for a course, preferring the readable name over the code. */
export function courseLabel(course: CanvasCourse | undefined, fallbackId?: string): string {
    if (!course) return fallbackId ? `Course ${fallbackId}` : 'Unknown course';
    return course.name ?? course.course_code ?? `Course ${idToString(course.id)}`;
}

/** Id-keyed lookup so items carrying only a course_id can be labelled. */
export function courseMap(courses: CanvasCourse[]): Map<string, CanvasCourse> {
    return new Map(courses.map((course) => [idToString(course.id), course]));
}

/**
 * Planner items in a date window.
 *
 * This is the single richest "what do I need to do" endpoint Canvas has — it
 * already merges assignments, quizzes, discussions, calendar events and to-dos,
 * and carries submission state inline, so no client-side merging is needed.
 */
export function getPlannerItems(
    client: CanvasClient,
    startDate: Date,
    endDate: Date,
): Promise<CanvasPlannerItem[]> {
    const start = startDate.toISOString();
    const end = endDate.toISOString();
    return client.cached(`planner:${start}:${end}`, SHORT_TTL_MS, () =>
        client.getAll<CanvasPlannerItem>('/api/v1/planner/items', {
            start_date: start,
            end_date: end,
        }),
    );
}

/**
 * Announcements across the given courses.
 *
 * The endpoint requires `context_codes[]`, so callers must resolve courses first.
 * Canvas rejects the request outright if the list is empty.
 */
export function getAnnouncements(
    client: CanvasClient,
    courses: CanvasCourse[],
    startDate: Date,
    endDate: Date,
): Promise<CanvasAnnouncement[]> {
    if (courses.length === 0) return Promise.resolve([]);
    const contextCodes = courses.map((course) => `course_${idToString(course.id)}`);
    const start = startDate.toISOString();
    const end = endDate.toISOString();
    return client.cached(`announcements:${start}:${end}:${contextCodes.join(',')}`, SHORT_TTL_MS, () =>
        client.getAll<CanvasAnnouncement>('/api/v1/announcements', {
            'context_codes[]': contextCodes,
            start_date: start,
            end_date: end,
            active_only: true,
        }),
    );
}

/** Active enrollments, which carry current scores per course. */
export function getEnrollments(client: CanvasClient): Promise<CanvasEnrollment[]> {
    return client.cached('enrollments:active', SHORT_TTL_MS, () =>
        client.getAll<CanvasEnrollment>('/api/v1/users/self/enrollments', {
            'state[]': ['active'],
            'type[]': ['StudentEnrollment'],
        }),
    );
}

/** Assignments for a course with the current user's submission attached. */
export function getCourseAssignments(
    client: CanvasClient,
    courseId: string,
    bucket?: string,
): Promise<CanvasAssignment[]> {
    return client.cached(`assignments:${courseId}:${bucket ?? 'all'}`, SHORT_TTL_MS, () =>
        client.getAll<CanvasAssignment>(`/api/v1/courses/${courseId}/assignments`, {
            'include[]': ['submission'],
            bucket,
            order_by: 'due_at',
        }),
    );
}

/** The course id an announcement belongs to, parsed out of `course_1234`. */
export function announcementCourseId(announcement: CanvasAnnouncement): string {
    const match = /^course_(.+)$/.exec(announcement.context_code ?? '');
    return match?.[1] ?? '';
}
