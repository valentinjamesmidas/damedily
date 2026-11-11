import type { Metadata } from "next";
import { LoginForm } from "@/components/admin/login-form";
import { safeNextPath } from "@/lib/auth/next-path";
import { publicSupabaseEnv } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Přihlášení do administrace",
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ chyba?: string; next?: string }>;
}) {
  const params = await searchParams;
  const configured = publicSupabaseEnv() !== null;
  return <LoginForm configured={configured} nextPath={safeNextPath(params.next ?? null)} />;
}
