"use client";
import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";
// Lazy initialization lets the demo render and build without environment variables.
export function createClient() {
  const { url, publishableKey } = getSupabaseConfig();
  return createBrowserClient(url, publishableKey);
}
