export type AccessRole = "admin" | "customer" | "unknown";

export type AdminAccessInput = {
  pathname: string;
  configured: boolean;
  userId: string | null;
  role: AccessRole | null;
};

export type AdminAccessDecision = {
  allow: boolean;
  redirectTo: string | null;
};

function isLogin(pathname: string): boolean {
  return pathname === "/admin/prihlaseni" || pathname.startsWith("/admin/prihlaseni/");
}

function isDenied(pathname: string): boolean {
  return pathname === "/admin/pristup" || pathname.startsWith("/admin/pristup/");
}

/**
 * Rozhodnutí pro middleware. Bez uživatele, bez role admin nebo bez nastaveného
 * Supabase se sklad neotevře. Neznámá role je totéž co zákazník.
 */
export function decideAdminAccess(input: AdminAccessInput): AdminAccessDecision {
  if (!input.configured) {
    if (isLogin(input.pathname)) return { allow: true, redirectTo: null };
    return { allow: false, redirectTo: "/admin/prihlaseni?chyba=konfigurace" };
  }

  if (!input.userId) {
    if (isLogin(input.pathname)) return { allow: true, redirectTo: null };
    const next = input.pathname.startsWith("/admin") ? `?next=${encodeURIComponent(input.pathname)}` : "";
    return { allow: false, redirectTo: `/admin/prihlaseni${next}` };
  }

  if (input.role !== "admin") {
    if (isDenied(input.pathname) || isLogin(input.pathname)) return { allow: true, redirectTo: null };
    return { allow: false, redirectTo: "/admin/pristup" };
  }

  if (isLogin(input.pathname) || isDenied(input.pathname)) {
    return { allow: false, redirectTo: "/admin" };
  }
  return { allow: true, redirectTo: null };
}
