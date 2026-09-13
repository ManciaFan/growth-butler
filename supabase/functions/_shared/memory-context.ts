import type { SupabaseClient } from "@supabase/supabase-js";
import { PlanError } from "../generate-tomorrow-plan/errors.ts";
export async function activeMemoryContext(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("memories")
    .select("id,category,key,value,confidence")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(101);
  if (error) throw new PlanError("DATABASE_ERROR", 503);
  if (data.length > 100 || JSON.stringify(data).length > 18000)
    throw new PlanError("CONTEXT_TOO_LARGE", 422);
  return data as {
    id: string;
    category: string;
    key: string;
    value: string;
    confidence: string;
  }[];
}
