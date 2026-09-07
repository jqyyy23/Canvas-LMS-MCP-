/**
 * Shapes of the Canvas objects we read.
 *
 * These are deliberately loose: every field is optional beyond the identifiers,
 * because Canvas installs vary by version and by which `include[]` values were
 * requested, and a strict parse that throws on an unexpected payload would be
 * worse than rendering what we did get. Ids are typed `string | number` — Canvas
 * returns strings when the `application/json+canvas-string-ids` Accept header is
 * sent, which the client does.
 */

export type CanvasId = string | number;

export interface CanvasUser {
    id: CanvasId;
    name?: string;
    short_name?: string;
    sortable_name?: string;
    primary_email?: string;
    email?: string;
    login_id?: string;
    effective_locale?: string;
}

export interface CanvasTerm {
    id?: CanvasId;
    name?: string;
    start_at?: string | null;
    end_at?: string | null;
}

export interface CanvasEnrollment {
    id?: CanvasId;
    course_id?: CanvasId;
    type?: string;
    role?: string;
    enrollment_state?: string;
    grades?: {
        current_score?: number | null;
        final_score?: number | null;
        current_grade?: string | null;
        final_grade?: string | null;
        html_url?: string;
    };
}

export interface CanvasCourse {
    id: CanvasId;
    name?: string;
    course_code?: string;
    workflow_state?: string;
    syllabus_body?: string | null;
    start_at?: string | null;
    end_at?: string | null;
    term?: CanvasTerm;
    enrollments?: CanvasEnrollment[];
    /** Present when `include[]=concluded` style flags are used. */
    concluded?: boolean;
    access_restricted_by_date?: boolean;
}

export interface CanvasSubmission {
    id?: CanvasId;
    assignment_id?: CanvasId;
    submitted_at?: string | null;
    graded_at?: string | null;
    score?: number | null;
    grade?: string | null;
    workflow_state?: string;
    late?: boolean;
    missing?: boolean;
    excused?: boolean;
    attempt?: number | null;
}

export interface CanvasAssignment {
    id: CanvasId;
    name?: string;
    description?: string | null;
    due_at?: string | null;
    unlock_at?: string | null;
    lock_at?: string | null;
    points_possible?: number | null;
    html_url?: string;
    course_id?: CanvasId;
    submission_types?: string[];
    has_submitted_submissions?: boolean;
    published?: boolean;
    submission?: CanvasSubmission;
    rubric?: Array<{
        id?: string;
        description?: string;
        long_description?: string;
        points?: number;
    }>;
    allowed_attempts?: number | null;
}

export interface CanvasAnnouncement {
    id: CanvasId;
    title?: string;
    message?: string | null;
    posted_at?: string | null;
    delayed_post_at?: string | null;
    html_url?: string;
    url?: string;
    /** e.g. `course_1234` — the announcements endpoint returns this. */
    context_code?: string;
    author?: { display_name?: string };
    user_name?: string;
    read_state?: string;
    locked?: boolean;
}

/**
 * A planner item. This is the richest single endpoint Canvas offers for "what do
 * I need to do": it already unifies assignments, quizzes, discussions, calendar
 * events, and to-dos, and carries submission state inline.
 */
export interface CanvasPlannerItem {
    /** assignment | quiz | discussion_topic | wiki_page | planner_note | calendar_event | … */
    plannable_type?: string;
    plannable_id?: CanvasId;
    course_id?: CanvasId;
    context_type?: string;
    context_name?: string;
    plannable_date?: string | null;
    html_url?: string;
    plannable?: {
        id?: CanvasId;
        title?: string;
        name?: string;
        due_at?: string | null;
        todo_date?: string | null;
        start_at?: string | null;
        points_possible?: number | null;
        details?: string | null;
    };
    submissions?:
        | false
        | {
              submitted?: boolean;
              excused?: boolean;
              graded?: boolean;
              late?: boolean;
              missing?: boolean;
              needs_grading?: boolean;
              has_feedback?: boolean;
              redo_request?: boolean;
          };
    planner_override?: {
        id?: CanvasId;
        marked_complete?: boolean;
        dismissed?: boolean;
    } | null;
    new_activity?: boolean;
}

export interface CanvasModuleItem {
    id?: CanvasId;
    title?: string;
    type?: string;
    html_url?: string;
    completion_requirement?: {
        type?: string;
        completed?: boolean;
    };
}

export interface CanvasModule {
    id?: CanvasId;
    name?: string;
    position?: number;
    state?: string;
    completed_at?: string | null;
    unlock_at?: string | null;
    items?: CanvasModuleItem[];
    items_count?: number;
}
