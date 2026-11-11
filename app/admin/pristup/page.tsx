import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminAccess } from "@/components/admin/admin-access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Přístup odepřen",
};

export default async function AdminDeniedPage() {
  const supabase = await createClient();
  if (!supabase) redirect("/admin/prihlaseni?chyba=konfigurace");
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/admin/prihlaseni");
  const profile = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (profile.data?.role === "admin") redirect("/admin");
  return <AdminAccess status="customer" />;
}
