import { describe, expect, it } from "vitest";
import { publicSupabaseEnv } from "./env";

describe("veřejné nastavení Supabase", () => {
  it("vezme jen předané veřejné hodnoty a ořeže lomítko", () => {
    expect(
      publicSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321/",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "tajne",
      }),
    ).toEqual({ url: "http://127.0.0.1:54321", anonKey: "anon" });
  });

  it("bez adresy nebo klíče nevrátí nic", () => {
    expect(publicSupabaseEnv({})).toBeNull();
    expect(publicSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBeNull();
  });
});
