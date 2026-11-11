import { expect, test } from "@playwright/test";

test("úvod se načte a taby se přepínají", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Díly, které projdou/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Dílobot" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Dílobot je AI asistent DámeDíly.cz.")).toBeVisible();
  await page.getByRole("tab", { name: "Katalog" }).click();
  await expect(page.getByRole("tab", { name: "Katalog" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Značka")).toBeVisible();
  await expect(page.getByLabel("Rok a motorizace")).toBeVisible();
  await page.getByRole("tab", { name: "Foto" }).click();
  await expect(page.getByLabel("OEM ručně")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Akční nabídka" })).toBeVisible();
  await expect(page.getByText("AKČNÍ NABÍDKA – IHNED K ODBĚRU").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stálá nabídka" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pneu pro dodávky – Skladem" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Obchodní podmínky" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Odstoupení do 14 dnů" })).toBeVisible();
});

test("admin bez přihlášení přesměruje a sklad neukáže", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/prihlaseni/);
  await expect(page.getByRole("heading", { name: "Přihlášení do administrace" })).toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByRole("button", { name: "Poslat přihlašovací odkaz" })).toBeVisible();
  await expect(page.getByText("Nákupní cena", { exact: true })).toHaveCount(0);
});

test("chráněné API admina bez přihlášení neotevře", async ({ request }) => {
  const response = await request.post("/api/admin/vision", {
    data: { mediaType: "image/jpeg", data: "aaaa" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(response.headers().location ?? "").toContain("/admin/prihlaseni");
});
