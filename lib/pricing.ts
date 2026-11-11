/** Minimální hodnota objednávky v Kč. Pod limitem se objednávka nespustí. */
export const MIN_ORDER_CZK = 2000;

function assertMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} musí být nezáporné konečné číslo.`);
  }
}

/**
 * Prodejní cena v Kč.
 * Přesně `Math.ceil((cost * 1.5) / 10) * 10` — zaokrouhlení marže +50 % nahoru na desetikoruny.
 */
export function sellingPrice(cost: number): number {
  assertMoney(cost, "Nákupní cena");
  return Math.ceil((cost * 1.5) / 10) * 10;
}

/** Kolik Kč ještě chybí do minima. Na limitu a nad ním vrací 0. */
export function amountMissingForMinimum(totalCzk: number): number {
  assertMoney(totalCzk, "Částka objednávky");
  const missing = MIN_ORDER_CZK - totalCzk;
  if (missing <= 0) {
    return 0;
  }
  return Math.round(missing * 100) / 100;
}

function formatCzk(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const hasDecimals = Math.round(rounded * 100) % 100 !== 0;
  return new Intl.NumberFormat("cs-CZ", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  })
    .format(rounded)
    .replace(/[\u00a0\u202f]/g, " ");
}

/**
 * Hláška pod minimem. Na limitu a nad ním vrací null.
 * Text je daný obchodním pravidlem.
 */
export function minimumOrderMessage(totalCzk: number): string | null {
  const missing = amountMissingForMinimum(totalCzk);
  if (missing === 0) {
    return null;
  }

  return `Minimální hodnota objednávky pro spuštění důkladné ruční kontroly a expedice se zárukou je ${formatCzk(MIN_ORDER_CZK)} Kč. Doplňte košík o další díl nebo provozní příslušenství (chybí ještě ${formatCzk(missing)} Kč).`;
}
