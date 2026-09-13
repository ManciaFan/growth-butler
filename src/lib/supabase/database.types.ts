export type GoalStatus = "active" | "completed" | "paused";
export type Course = BaseRow &
  import("../../../supabase/functions/_shared/schedule-schema").CourseEntry;
export type ScheduleSettings = {
  user_id: string;
  period_times: import("../../../supabase/functions/_shared/schedule-schema").PeriodTime[];
  updated_at: string;
};
export type ChatSession = BaseRow & { title: string; archived: boolean };
export type ChatMessage = {
  id: string;
  user_id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  metadata: Record<string, unknown>;
};
export type Memory = BaseRow & {
  category: string;
  key: string;
  value: string;
  status: "proposed" | "active" | "superseded" | "invalidated";
  confidence: "low" | "medium" | "high";
  source_message_id: string | null;
  supersedes_memory_id: string | null;
};
export type PeriodSummary = {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  summary: string;
  created_at: string;
};
type BaseRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};
export type Goal = BaseRow & {
  title: string;
  description: string;
  status: GoalStatus;
};
export type DailyPlan = BaseRow & { plan_date: string; main_goal: string };
export type Task = BaseRow & {
  daily_plan_id: string;
  title: string;
  completed: boolean;
  estimated_minutes: number;
  sort_order: number;
  reason: string;
  success_criteria: string;
};
export type Feedback = BaseRow & {
  feedback_date: string;
  content: string;
  energy_level: number | null;
};
type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};
export type Database = {
  public: {
    Tables: {
      course_schedule: Table<
        Course,
        "user_id" | "course_date" | "title" | "period_start" | "period_end"
      >;
      schedule_settings: Table<ScheduleSettings, "user_id" | "period_times">;
      chat_sessions: Table<ChatSession, "user_id">;
      chat_messages: Table<
        ChatMessage,
        "user_id" | "session_id" | "role" | "content"
      >;
      memories: Table<
        Memory,
        "user_id" | "category" | "key" | "value" | "confidence"
      >;
      period_summaries: Table<
        PeriodSummary,
        "user_id" | "period_start" | "period_end" | "summary"
      >;
      goals: Table<Goal, "user_id" | "title">;
      daily_plans: Table<DailyPlan, "user_id" | "plan_date">;
      tasks: Table<Task, "user_id" | "daily_plan_id" | "title">;
      daily_feedback: Table<Feedback, "user_id" | "feedback_date">;
    };
    Views: { [_ in never]: never };
    Functions: {
      import_course_schedule: {
        Args: {
          p_entries: import("../../../supabase/functions/_shared/schedule-schema").CourseEntry[];
        };
        Returns: number;
      };
      confirm_memory: {
        Args: {
          p_id: string;
          p_category: string;
          p_key: string;
          p_value: string;
          p_confidence: string;
          p_source: string | null;
          p_previous: string | null;
          p_action: string;
        };
        Returns: string;
      };
      adopt_tomorrow_plan: {
        Args: {
          p_source_date: string;
          p_proposal: import("../../../supabase/functions/_shared/plan-schema").PlanProposal;
          p_plan_id: string;
        };
        Returns: string;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
