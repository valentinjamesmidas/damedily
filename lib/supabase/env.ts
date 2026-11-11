export type PublicSupabaseEnv = {
  url: string;
  anonKey: string;
};

/** Jen veřejné hodnoty. Service role sem nepatří a v prohlížeči se nečte. */
export function publicSupabaseEnv(env?: Record<string, string | undefined>): PublicSupabaseEnv | null {
  // Přímý zápis process.env.NEXT_PUBLIC_* je nutný, aby ho Next vložil do prohlížeče.
  const url = (env ? env.NEXT_PUBLIC_SUPABASE_URL : process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const anonKey = (env ? env.NEXT_PUBLIC_SUPABASE_ANON_KEY : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!url || !anonKey) return null;
  return { url: url.replace(/\/$/, ""), anonKey };
}
