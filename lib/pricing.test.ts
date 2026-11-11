import { describe, expect, it } from "vitest";
import {
  MIN_ORDER_CZK,
  amountMissingForMinimum,
  minimumOrderMessage,
  sellingPrice,
} from "./pricing";

describe("sellingPrice", () => {
  it.each([
    [0, 0],
    [0.4, 10],
    [1, 10],
    [7, 20],
    [10, 20],
    [20, 30],
    [100, 150],
    [101, 160],
    [333, 500],
    [1999, 3000],
    [2000, 3000],
  ])("nákup %s Kč prodává za %s Kč", (cost, expected) => {
    expect(sellingPrice(cost)).toBe(expected);
  });

  it("použije přesně Math.ceil((cost * 1.5) / 10) * 10", () => {
    const cost = 19.99;
    expect(sellingPrice(cost)).toBe(Math.ceil((cost * 1.5) / 10) * 10);
    expect(sellingPrice(cost)).toBe(30);
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

  it.each([
    [0, 2000],
    [1500, 500],
    [1999.5, 0.5],
    [2000, 0],
    [2000.01, 0],
    [4500, 0],
  ])("z částky %s Kč chybí %s Kč", (total, missing) => {
    expect(amountMissingForMinimum(total)).toBe(missing);
  });

  it("sestaví povinnou hlášku včetně chybějící částky", () => {
    expect(minimumOrderMessage(1500)).toBe(
      "Minimální hodnota objednávky pro spuštění důkladné ruční kontroly a expedice se zárukou je 2 000 Kč. Doplňte košík o další díl nebo provozní příslušenství (chybí ještě 500 Kč).",
    );
  });

  it("formátuje desetinnou chybějící částku česky", () => {
    expect(minimumOrderMessage(1999.5)).toContain("chybí ještě 0,50 Kč");
  });

  it("na limitu a nad ním hlášku nevrací", () => {
    expect(minimumOrderMessage(2000)).toBeNull();
    expect(minimumOrderMessage(2000.01)).toBeNull();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "odmítne neplatnou částku objednávky %s",
    (total) => {
      expect(() => amountMissingForMinimum(total)).toThrow(TypeError);
      expect(() => minimumOrderMessage(total)).toThrow(TypeError);
    },
  );
});
