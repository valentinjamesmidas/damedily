"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseEnv } from "@/lib/supabase/env";

let client: SupabaseClient | null | undefined;

export function createBrowserSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const env = publicSupabaseEnv();
  client = env ? createBrowserClient(env.url, env.anonKey) : null;
  return client;
}
