import type { NextRequest } from "next/server";
import { guardAdmin } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return guardAdmin(request);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
