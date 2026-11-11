/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdminAccess } from "./admin-access";

afterEach(() => cleanup());

describe("ochrana administrace", () => {
  it("nepřihlášenému sklad neukáže", () => {
    render(
      <AdminAccess status="anonymous">
        <p>Nákupní cena</p>
      </AdminAccess>,
    );
    expect(screen.getByRole("heading", { name: "Přihlaste se" })).toBeTruthy();
    expect(screen.queryByText("Nákupní cena")).toBeNull();
  });

  it("zákazníkovi sklad neukáže", () => {
    render(
      <AdminAccess status="customer">
        <p>Nákupní cena</p>
      </AdminAccess>,
    );
    expect(screen.getByRole("heading", { name: "Přístup odepřen" })).toBeTruthy();
    expect(screen.queryByText("Nákupní cena")).toBeNull();
  });

  it("adminovi obsah pustí", () => {
    render(
      <AdminAccess status="admin">
        <p>Sklad</p>
      </AdminAccess>,
    );
    expect(screen.getByText("Sklad")).toBeTruthy();
  });
});
