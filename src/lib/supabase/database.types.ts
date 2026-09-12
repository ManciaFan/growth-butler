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
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
