export type GoalStatus = "active" | "completed" | "paused";
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
      goals: Table<Goal, "user_id" | "title">;
      daily_plans: Table<DailyPlan, "user_id" | "plan_date">;
      tasks: Table<Task, "user_id" | "daily_plan_id" | "title">;
      daily_feedback: Table<Feedback, "user_id" | "feedback_date">;
    };
    Views: { [_ in never]: never };
    Functions: {
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
