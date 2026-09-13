import { createClient } from "@supabase/supabase-js";
import { handleChat } from "./handler.ts";
import { PlanError } from "../generate-tomorrow-plan/errors.ts";

function publishableKey() {
  const keyMap = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  const key =
    (keyMap ? JSON.parse(keyMap).default : undefined) ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
    Deno.env.get("SUPABASE_ANON_KEY");
  if (typeof key !== "string" || !key || key.startsWith("sb_secret_"))
    throw new PlanError("AI_CONFIG_ERROR", 503);
  return key;
}
Deno.serve((request) =>
  handleChat(request, {
    createUserClient: (jwt) =>
      createClient(Deno.env.get("SUPABASE_URL") ?? "", publishableKey(), {
        global: {
          headers: { Authorization: `Bearer ${jwt}` },
          fetch: (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(12000) }),
        },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }),
    getAIConfig: () => ({
      apiKey: Deno.env.get("DEEPSEEK_API_KEY") ?? "",
      baseUrl: Deno.env.get("DEEPSEEK_BASE_URL") ?? "",
      model: Deno.env.get("DEEPSEEK_MODEL") ?? "",
    }),
  }),
);
