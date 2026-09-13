import { activeMemoryContext } from "../_shared/memory-context.ts";
import { readSchedule } from "../_shared/schedule-context.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dateWindow } from "../_shared/plan-schema.ts";
import { loadContext } from "./context.ts";
import { PlanError } from "./errors.ts";
import { boundedText, generateProposal, type AIConfig } from "./provider.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
type Dependencies = {
  createUserClient: (jwt: string) => SupabaseClient;
  getAIConfig: () => AIConfig;
  fetcher?: typeof fetch;
  now?: () => Date;
};
export async function handleRequest(
  request: Request,
  deps: Dependencies,
): Promise<Response> {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (request.method !== "POST")
    return new Response(
      JSON.stringify({
        code: "INVALID_REQUEST",
        message: "仅支持 POST 请求。",
      }),
      { status: 405, headers },
    );
  try {
    const token = request.headers
      .get("Authorization")
      ?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token || token.length > 8192)
      throw new PlanError("UNAUTHENTICATED", 401);
    const db = deps.createUserClient(token);
    const {
      data: { user },
      error,
    } = await db.auth.getUser(token);
    if (error)
      throw new PlanError(
        error.status && error.status >= 500
          ? "AUTH_UNAVAILABLE"
          : "UNAUTHENTICATED",
        error.status && error.status >= 500 ? 503 : 401,
      );
    if (!user || user.is_anonymous) throw new PlanError("UNAUTHENTICATED", 401);
    const dates = dateWindow(deps.now?.());
    let body;
    try {
      if (!request.headers.get("Content-Type")?.includes("application/json"))
        throw new Error();
      body = JSON.parse(await boundedText(new Response(request.body), 1024));
      if (
        !body ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof body.source_date !== "string"
      )
        throw new Error();
    } catch {
      throw new PlanError("INVALID_REQUEST", 400);
    }
    if (body.source_date !== dates.today)
      throw new PlanError("DATE_CHANGED", 409);
    const context = {
      ...(await loadContext(db, user.id, dates)),
      course_schedule: await readSchedule(db, user.id, [dates.tomorrow]),
      active_memories: (await activeMemoryContext(db, user.id)).map(
        ({ category, key, value, confidence }) => ({
          category,
          key,
          value,
          confidence,
        }),
      ),
    };
    const proposal = await generateProposal(
      context,
      deps.getAIConfig(),
      deps.fetcher,
    );
    if (dateWindow(deps.now?.()).today !== dates.today)
      throw new PlanError("DATE_CHANGED", 409);
    return new Response(
      JSON.stringify({
        source_date: dates.today,
        plan_date: dates.tomorrow,
        proposal,
      }),
      { status: 200, headers },
    );
  } catch (cause) {
    // Never log request bodies, tokens, environment values, provider bodies or raw exceptions.
    const error =
      cause instanceof PlanError ? cause : new PlanError("DATABASE_ERROR", 503);
    return new Response(
      JSON.stringify({ code: error.code, message: error.message }),
      { status: error.status, headers },
    );
  }
}
