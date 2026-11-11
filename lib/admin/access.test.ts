import { describe, expect, it } from "vitest";
import { decideAdminAccess } from "./access";

describe("ochrana /admin", () => {
  it("nepřihlášeného pošle na přihlášení a sklad nepustí", () => {
    expect(
      decideAdminAccess({ pathname: "/admin", configured: true, userId: null, role: null }),
    ).toEqual({ allow: false, redirectTo: "/admin/prihlaseni?next=%2Fadmin" });
    expect(
      decideAdminAccess({ pathname: "/admin/prihlaseni", configured: true, userId: null, role: null }).allow,
    ).toBe(true);
  });

  it("zákazníka a neznámou roli pustí jen na stránku odepření", () => {
    expect(
      decideAdminAccess({ pathname: "/admin", configured: true, userId: "u1", role: "customer" }),
    ).toEqual({ allow: false, redirectTo: "/admin/pristup" });
    expect(
      decideAdminAccess({ pathname: "/admin", configured: true, userId: "u1", role: "unknown" }).redirectTo,
    ).toBe("/admin/pristup");
    expect(
      decideAdminAccess({ pathname: "/admin/pristup", configured: true, userId: "u1", role: "customer" }).allow,
    ).toBe(true);
  });

  it("admina pustí do skladu a z přihlášení ho vrátí dovnitř", () => {
    expect(decideAdminAccess({ pathname: "/admin", configured: true, userId: "u1", role: "admin" })).toEqual({
      allow: true,
      redirectTo: null,
    });
    expect(
      decideAdminAccess({ pathname: "/admin/prihlaseni", configured: true, userId: "u1", role: "admin" }).redirectTo,
    ).toBe("/admin");
  });

  it("bez nastaveného Supabase sklad neotevře", () => {
    expect(
      decideAdminAccess({ pathname: "/admin", configured: false, userId: "u1", role: "admin" }).redirectTo,
    ).toBe("/admin/prihlaseni?chyba=konfigurace");
  });
});
