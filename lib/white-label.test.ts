import { describe, expect, it } from "vitest";
import { sellingPrice } from "./pricing";
import {
  EXTERNAL_DELIVERY_LEAD_TIME,
  OWN_STOCK_AVAILABILITY,
  SOURCE_PLATFORMS,
  serializePublicOffer,
  toPublicOffer,
  type OfferDraft,
  type PublicOffer,
} from "./white-label";

type SecretKey =
  | "cost_price"
  | "cost_price_czk"
  | "costPriceCzk"
  | "source_platform"
  | "sourcePlatform"
  | "internal_project_tag"
  | "internalProjectTag"
  | "aiScore"
  | "ai_score"
  | "supplier_order_ref"
  | "supplierOrderRef";

type PublicOfferLeak = Extract<keyof PublicOffer, SecretKey>;
const publicOfferHidesSecrets: PublicOfferLeak extends never ? true : never = true;

const FORBIDDEN_NAMES = [
  "ovoko",
  "b-parts",
  "bparts",
  "b parts",
  "autodoc",
  "inter cars",
  "intercars",
  "auto partner",
  "autopartner",
];

function draft(overrides: Partial<OfferDraft> = {}): OfferDraft {
  return {
    titleCs: "Brzdový kotouč přední",
    descriptionCs: "Průměr 280 mm.",
    oemNumber: "1K0615301",
    condition: "pouzity",
    conditionDetail: "Drobné stopy po provozu, bez prasklin.",
    originKind: "oem",
    sourcePlatform: "ovoko",
    costPriceCzk: 333,
    internalProjectTag: "damedily",
    aiScore: 0.87,
    ...overrides,
  };
}

describe("veřejná nabídka", () => {
  it("typ nemá nákupní cenu, zdroj, tag ani AI skóre", () => {
    expect(publicOfferHidesSecrets).toBe(true);
  });

  it("počítá prodejní cenu přes marži a do JSON tajné údaje nedá", () => {
    const offer = toPublicOffer(draft());
    expect(offer.sellingPriceCzk).toBe(sellingPrice(333));
    expect(offer.sellingPriceCzk).toBe(500);
    expect(offer.condition).toBe("pouzity");
    expect(offer.conditionLabel).toBe("Použitý");
    expect(offer.conditionDetail).toBe("Drobné stopy po provozu, bez prasklin.");
    expect(offer.originLabel).toBe("OEM");
    expect(offer.deliveryLeadTime).toBe(EXTERNAL_DELIVERY_LEAD_TIME);

    const poisoned = {
      ...offer,
      cost_price_czk: 333,
      costPriceCzk: 333,
      source_platform: "ovoko",
      sourcePlatform: "ovoko",
      internal_project_tag: "damedily",
      internalProjectTag: "ekokladno",
      aiScore: 0.87,
      ai_score: 0.87,
      supplier_order_ref: "SUP-1",
    };
    const serialized = serializePublicOffer(poisoned);
    const keys = Object.keys(JSON.parse(serialized) as Record<string, unknown>);
    expect(keys).toEqual([
      "titleCs",
      "descriptionCs",
      "oemNumber",
      "condition",
      "conditionLabel",
      "conditionDetail",
      "originKind",
      "originLabel",
      "warehouseLabel",
      "sellingPriceCzk",
      "deliveryLeadTime",
    ]);
    const lowered = serialized.toLowerCase();
    for (const key of [
      "cost_price",
      "costpriceczk",
      "source_platform",
      "sourceplatform",
      "internal_project_tag",
      "internalprojecttag",
      "aiscore",
      "ai_score",
      "supplier_order_ref",
    ]) {
      expect(lowered).not.toContain(key);
    }
    for (const name of FORBIDDEN_NAMES) {
      expect(lowered).not.toContain(name);
    }
  });

  it("u každého externího zdroje maskuje název a uvádí 4–5 pracovních dní", () => {
    for (const sourcePlatform of SOURCE_PLATFORMS) {
      const offer = toPublicOffer(
        draft({
          sourcePlatform,
          condition: sourcePlatform === "autodoc" ? "novy" : "pouzity",
          originKind: sourcePlatform === "inter_cars" ? "druhovyroba" : "oem",
          descriptionCs: "Díl z Ovoko, B-Parts, Autodoc, Inter Cars a Auto Partner. AI skóre: 0,91.",
        }),
      );
      const serialized = serializePublicOffer(offer).toLowerCase();
      for (const name of FORBIDDEN_NAMES) {
        expect(serialized, sourcePlatform).not.toContain(name);
      }
      expect(offer.warehouseLabel, sourcePlatform).not.toMatch(
        /v\s+čr|v\s+česku|české republice|už\s+leží|již\s+skladem|ověřený uzel/i,
      );
      expect(offer.descriptionCs).not.toMatch(/skóre|0,91/i);
      if (sourcePlatform === "internal_stock") {
        expect(offer.deliveryLeadTime).toBe(OWN_STOCK_AVAILABILITY);
        expect(offer.warehouseLabel).toBe("Vlastní sklad DámeDíly.cz");
      } else {
        expect(offer.deliveryLeadTime).toBe("4–5 pracovních dní");
        expect(offer.warehouseLabel.startsWith("Externí nabídka – Sektor ")).toBe(true);
      }
    }
  });

  it("nevymýšlí OEM ani druhovýrobu, když podklad mlčí", () => {
    const offer = toPublicOffer(
      draft({ originKind: null, oemNumber: null, descriptionCs: null, condition: "novy" }),
    );
    expect(offer.originKind).toBe("neuvedeno");
    expect(offer.originLabel).toBe("V podkladu neuvedeno");
    expect(offer.oemNumber).toBeNull();
    expect(offer.descriptionCs).toBeNull();
    expect(offer.conditionLabel).toBe("Nový");
  });

  it("nezveřejní nabídku bez stavu nebo složenou jen z názvu zdroje", () => {
    expect(() => toPublicOffer(draft({ conditionDetail: "  Ovoko  " }))).toThrow(TypeError);
    expect(() => toPublicOffer(draft({ titleCs: "Auto Partner" }))).toThrow(TypeError);
    expect(() => toPublicOffer(draft({ costPriceCzk: -1 }))).toThrow(TypeError);
  });
});
