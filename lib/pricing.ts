/** Minimální hodnota objednávky v Kč. Pod limitem se objednávka nespustí. */
export const MIN_ORDER_CZK = 2000;

/**
 * Pásma marže podle nákupní ceny (whitepaper kap. 3.2).
 * Horní hranice je včetně. Poslední pásmo je bez stropu.
 * Uvnitř pásma se cena zaokrouhlí `Math.ceil((nákup * (1 + marže)) / 10) * 10`.
 * Aby vyšší nákup nikdy nedal nižší prodej, výsledek je
 * max(výpočet pásma, prodejní cena na stropu předchozího pásma).
 */
const MARKUP_BANDS = [
  { ceilingCzk: 1000, markup: 0.6 },
  { ceilingCzk: 5000, markup: 0.5 },
  { ceilingCzk: 15000, markup: 0.5 },
  { ceilingCzk: 40000, markup: 0.3 },
  { ceilingCzk: Number.POSITIVE_INFINITY, markup: 0.25 },
] as const;

export const ORDER_LINE_KINDS = ["zbozi", "doprava", "sluzba"] as const;

export type OrderLineKind = (typeof ORDER_LINE_KINDS)[number];

export type PricedOrderLine = {
  lineKind: OrderLineKind;
  sellingPriceCzk: number;
  quantity: number;
};

function assertMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} musí být nezáporné konečné číslo.`);
  }
}

function roundUpToTen(amount: number): number {
  return Math.ceil(amount / 10) * 10;
}

function bandSelling(cost: number, markup: number): number {
  return roundUpToTen(cost * (1 + markup));
}

/**
 * Prodejní cena v Kč podle pásma nákupní ceny.
 * Jediný výpočet marže v aplikaci. Vlastní sklad ho použije jen jako předvyplnění;
 * do hledání jde uložená prodejní cena.
 */
export function sellingPrice(cost: number): number {
  assertMoney(cost, "Nákupní cena");
  const index = MARKUP_BANDS.findIndex((band) => cost <= band.ceilingCzk);
  const band = MARKUP_BANDS[index] ?? MARKUP_BANDS[MARKUP_BANDS.length - 1];
  const raw = bandSelling(cost, band.markup);
  if (index <= 0) return raw;
  const previous = MARKUP_BANDS[index - 1];
  return Math.max(raw, bandSelling(previous.ceilingCzk, previous.markup));
}

/** Součet zboží včetně DPH. Doprava a služba se nepočítají. */
export function goodsTotalCzk(lines: readonly PricedOrderLine[]): number {
  let total = 0;
  for (const line of lines) {
    if (!ORDER_LINE_KINDS.includes(line.lineKind)) {
      throw new TypeError("Řádek objednávky musí být zboží, doprava, nebo služba.");
    }
    assertMoney(line.sellingPriceCzk, "Cena řádku");
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new TypeError("Množství řádku musí být kladné celé číslo.");
    }
    if (line.lineKind === "zbozi") total += line.sellingPriceCzk * line.quantity;
  }
  return Math.round(total * 100) / 100;
}

/** Kolik Kč zboží ještě chybí do minima. Na limitu a nad ním vrací 0. */
export function amountMissingForMinimum(lines: readonly PricedOrderLine[]): number {
  const missing = MIN_ORDER_CZK - goodsTotalCzk(lines);
  if (missing <= 0) return 0;
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
 * Hláška pod minimem zboží. Na limitu a nad ním vrací null.
 * Text je daný obchodním pravidlem.
 */
export function minimumOrderMessage(lines: readonly PricedOrderLine[]): string | null {
  const missing = amountMissingForMinimum(lines);
  if (missing === 0) return null;

  return `Minimální hodnota objednávky pro spuštění důkladné ruční kontroly a expedice se zárukou je ${formatCzk(MIN_ORDER_CZK)} Kč. Doplňte košík o další díl nebo provozní příslušenství (chybí ještě ${formatCzk(missing)} Kč).`;
}
