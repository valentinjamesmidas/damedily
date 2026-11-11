import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideAdminAccess, type AccessRole } from "@/lib/admin/access";
import { publicSupabaseEnv } from "@/lib/supabase/env";

export async function guardAdmin(request: NextRequest): Promise<NextResponse> {
  const env = publicSupabaseEnv();
  let response = NextResponse.next({ request });
  let userId: string | null = null;
  let role: AccessRole | null = null;

  if (env) {
    const supabase = createServerClient(env.url, env.anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    try {
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
      if (data.user) {
        const profile = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
        role = profile.data?.role === "admin" || profile.data?.role === "customer" ? profile.data.role : "unknown";
      }
    } catch {
      userId = null;
      role = null;
    }
  }

  const decision = decideAdminAccess({
    pathname: request.nextUrl.pathname,
    configured: env !== null,
    userId,
    role,
  });

  if (decision.allow) return response;
  const redirect = NextResponse.redirect(new URL(decision.redirectTo ?? "/admin/prihlaseni", request.url));
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}
