/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InventoryForm } from "./inventory-form";

afterEach(() => cleanup());

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Název"), "Brzdový kotouč");
  await user.type(screen.getByLabelText("OEM"), "1K0615301");
  await user.type(screen.getByLabelText("Kategorie"), "Brzdy");
  await user.click(screen.getByLabelText("Nový"));
  await user.type(screen.getByLabelText("Popis stavu"), "Nový, bez koroze.");
  await user.type(screen.getByLabelText("Nákupní cena (Kč)"), "200");
  await user.click(screen.getByLabelText("Akční nabídka"));
}

describe("formulář skladu", () => {
  it("bez názvu položku neuloží", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<InventoryForm onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Uložit položku" }));
    expect(screen.getByRole("alert").textContent).toBe("Vyplňte název.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("předvyplní prodejní cenu a uloží bez projektového tagu", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<InventoryForm onSubmit={onSubmit} />);
    await fillRequired(user);
    expect(screen.getByLabelText("Prodejní cena (Kč)")).toHaveProperty("value", "300");
    expect(screen.queryByText("EKOKLADNO")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Uložit položku" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0].sellingPriceCzk).toBe(300);
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty("internalProjectTag");
  });
});
