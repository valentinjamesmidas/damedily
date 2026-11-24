import { describe, expect, it } from "vitest";
import {
  MIN_ORDER_CZK,
  amountMissingForMinimum,
  goodsTotalCzk,
  minimumOrderMessage,
  sellingPrice,
  type PricedOrderLine,
} from "./pricing";

const line = (lineKind: PricedOrderLine["lineKind"], sellingPriceCzk: number, quantity = 1): PricedOrderLine => ({
  lineKind,
  sellingPriceCzk,
  quantity,
});

describe("sellingPrice", () => {
  it.each([
    [0, 0],
    [0.4, 10],
    [10, 20],
    [100, 160],
    [333, 540],
    [1000, 1600],
    [1001, 1600],
    [5000, 7500],
    [5001, 7510],
    [15000, 22500],
    [15001, 22500],
    [40000, 52000],
    [40001, 52000],
  ])("nákup %s Kč prodává za %s Kč", (cost, expected) => {
    expect(sellingPrice(cost)).toBe(expected);
  });

  it("na hraně pásma nenechá vyšší nákup klesnout pod prodej nižšího nákupu", () => {
    const edges = [1000, 1001, 5000, 5001, 15000, 15001, 40000, 40001];
    for (let index = 1; index < edges.length; index += 1) {
      const lower = edges[index - 1] ?? 0;
      const higher = edges[index] ?? 0;
      expect(sellingPrice(higher)).toBeGreaterThanOrEqual(sellingPrice(lower));
    }
    expect(sellingPrice(1001)).toBe(sellingPrice(1000));
    expect(sellingPrice(15001)).toBe(sellingPrice(15000));
    expect(sellingPrice(40001)).toBe(sellingPrice(40000));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -0.01])(
    "odmítne neplatnou nákupní cenu %s",
    (cost) => {
      expect(() => sellingPrice(cost)).toThrow(TypeError);
    },
  );
});

describe("minimum objednávky", () => {
  it("drží limit 2 000 Kč", () => {
    expect(MIN_ORDER_CZK).toBe(2000);
  });

  it("do minima počítá jen zboží, dopravu a službu ne", () => {
    const lines = [
      line("zbozi", 1500),
      line("doprava", 600),
      line("sluzba", 400),
    ];
    expect(goodsTotalCzk(lines)).toBe(1500);
    expect(amountMissingForMinimum(lines)).toBe(500);
    expect(minimumOrderMessage(lines)).toContain("chybí ještě 500 Kč");
  });

  it("dvě položky zboží se sčítají a na limitu hláška zmizí", () => {
    const lines = [line("zbozi", 1000, 2), line("doprava", 200)];
    expect(goodsTotalCzk(lines)).toBe(2000);
    expect(amountMissingForMinimum(lines)).toBe(0);
    expect(minimumOrderMessage(lines)).toBeNull();
  });

  it("formátuje desetinnou chybějící částku česky", () => {
    expect(minimumOrderMessage([line("zbozi", 1999.5)])).toContain("chybí ještě 0,50 Kč");
  });

  it("sestaví povinnou hlášku včetně chybějící částky", () => {
    expect(minimumOrderMessage([line("zbozi", 1500)])).toBe(
      "Minimální hodnota objednávky pro spuštění důkladné ruční kontroly a expedice se zárukou je 2 000 Kč. Doplňte košík o další díl nebo provozní příslušenství (chybí ještě 500 Kč).",
    );
  });

  it("odmítne neplatný řádek", () => {
    expect(() => goodsTotalCzk([line("zbozi", -1)])).toThrow(TypeError);
    expect(() => amountMissingForMinimum([{ lineKind: "zbozi", sellingPriceCzk: 10, quantity: 0 }])).toThrow(TypeError);
  });
});
