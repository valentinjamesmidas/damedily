import { createClient } from "@/lib/supabase/server";

export async function requireAdmin() {
  const supabase = await createClient();
  if (!supabase) {
    return { ok: false as const, status: 503, message: "Přihlášení není nastavené." };
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return { ok: false as const, status: 401, message: "Pro tuhle akci se přihlaste." };
  }
  const profile = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profile.data?.role !== "admin") {
    return { ok: false as const, status: 403, message: "Tohle smí jen administrátor." };
  }
  return { ok: true as const, supabase, userId: data.user.id };
}
