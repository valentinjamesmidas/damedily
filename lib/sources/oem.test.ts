import { describe, expect, it } from "vitest";
import { isCacheableOem, normalizeOem, oemLookupPhrases } from "./oem";

describe("normalizeOem", () => {
  it("dá velká písmena a smaže mezery, tečky a pomlčky", () => {
    expect(normalizeOem("1k0 615 301")).toBe("1K0615301");
    expect(normalizeOem("1K0.615.301")).toBe("1K0615301");
    expect(normalizeOem("1k0-615-301")).toBe("1K0615301");
    expect(normalizeOem("  1k0. 615-301  ")).toBe("1K0615301");
  });

  it("složí stejné číslo z mezer, teček i pomlček", () => {
    const variants = ["1k0 615 301 ab", "1K0.615.301.AB", "1k0-615-301-ab", "1K0615301AB"];
    const normalized = variants.map((value) => normalizeOem(value));
    expect(new Set(normalized)).toEqual(new Set(["1K0615301AB"]));
  });

  it("maže tabulátor, konec řádku, nbsp a typografické pomlčky", () => {
    expect(normalizeOem("ab\tc")).toBe("ABC");
    expect(normalizeOem("ab\nc")).toBe("ABC");
    expect(normalizeOem("ab\u00A0c")).toBe("ABC");
    expect(normalizeOem("1K0\u2010615")).toBe("1K0615");
    expect(normalizeOem("1K0\u2011615")).toBe("1K0615");
    expect(normalizeOem("1K0\u2012615")).toBe("1K0615");
    expect(normalizeOem("1K0\u2013615")).toBe("1K0615");
    expect(normalizeOem("1K0\u2014615")).toBe("1K0615");
    expect(normalizeOem("1K0\u2212615")).toBe("1K0615");
  });

  it("lomítko bere jako pomlčku a pošle původní i kompaktní tvar", () => {
    expect(normalizeOem("a/b")).toBe("AB");
    expect(normalizeOem("1k0/615 301")).toBe("1K0615301");
    expect(oemLookupPhrases("1K0 615 301 AA")).toEqual(["1K0 615 301 AA", "1K0615301AA"]);
    expect(oemLookupPhrases("1K0615301AA")).toEqual(["1K0615301AA"]);
    expect(oemLookupPhrases("  1k0/615.301 AA ")).toEqual(["1k0/615.301 AA", "1K0615301AA"]);
  });

  it("nechá podtržítko, plus i čárku", () => {
    expect(normalizeOem("a_b")).toBe("A_B");
    expect(normalizeOem("a+b")).toBe("A+B");
    expect(normalizeOem("a,b")).toBe("A,B");
  });

  it("z prázdného a z samotných oddělovačů udělá prázdný řetězec", () => {
    expect(normalizeOem("")).toBe("");
    expect(normalizeOem("   ")).toBe("");
    expect(normalizeOem(".- –")).toBe("");
    expect(normalizeOem("...")).toBe("");
  });

  it("už hotové číslo nemění a malá písmena zvedne", () => {
    expect(normalizeOem("ABC123")).toBe("ABC123");
    expect(normalizeOem("abc")).toBe("ABC");
    expect(normalizeOem("A..B")).toBe("AB");
  });
});

describe("isCacheableOem", () => {
  it("vezme normalizované písmena a číslice do 80 znaků", () => {
    expect(isCacheableOem("1K0615301")).toBe(true);
    expect(isCacheableOem("A".repeat(80))).toBe(true);
  });

  it("odmítne prázdné, malé, dlouhé a znaky, které normalizace nechává", () => {
    expect(isCacheableOem("")).toBe(false);
    expect(isCacheableOem("1k0615301")).toBe(false);
    expect(isCacheableOem("1K0-615")).toBe(false);
    expect(isCacheableOem(normalizeOem("A/B"))).toBe(true);
    expect(isCacheableOem("A_B")).toBe(false);
    expect(isCacheableOem("A".repeat(81))).toBe(false);
  });
});
