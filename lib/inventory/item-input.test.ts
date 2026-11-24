import { describe, expect, it } from "vitest";
import { validateInventoryInput } from "./item-input";

const base = {
  id: null,
  titleCs: "Brzdový kotouč",
  oemNumber: "1K0615301",
  partCategory: "Brzdy",
  partCondition: "novy",
  conditionDetail: "Nový, bez koroze.",
  originKind: "druhovyroba",
  costPriceCzk: 200,
  sellingPriceCzk: null,
  stockQuantity: 2,
  placementType: "action_offer",
  source: "vlastni_sklad",
  images: [],
  vehicleText: "",
  tireSpecs: null,
};

describe("validace skladové položky", () => {
  it("bez původu skladu neprojde", () => {
    const result = validateInventoryInput({ ...base, source: "" });
    expect(result).toEqual({ ok: false, message: "Vyberte původ skladu." });
  });

  it("bez názvu neprojde", () => {
    const result = validateInventoryInput({ ...base, titleCs: "" });
    expect(result).toEqual({ ok: false, message: "Vyplňte název." });
  });

  it("prázdnou prodejní cenu doplní z nákupní a ruční přepis nechá", () => {
    const filled = validateInventoryInput(base);
    expect(filled.ok && filled.value.sellingPriceCzk).toBe(320);
    const override = validateInventoryInput({ ...base, sellingPriceCzk: 450 });
    expect(override.ok && override.value.sellingPriceCzk).toBe(450);
  });

  it("u pneu vyžaduje rozměr a jinde specifikaci zahodí", () => {
    const missing = validateInventoryInput({ ...base, placementType: "van_tires" });
    expect(missing.ok).toBe(false);
    const tire = validateInventoryInput({
      ...base,
      placementType: "van_tires",
      tireSpecs: { width: 215, profile: 65, diameter: "R16C", loadIndex: "109/107", season: "letni" },
    });
    expect(tire.ok && tire.value.tireSpecs?.diameter).toBe("R16C");
    const other = validateInventoryInput({
      ...base,
      tireSpecs: { width: 215, profile: 65, diameter: "R16C", loadIndex: "109/107", season: "letni" },
    });
    expect(other.ok && other.value.tireSpecs).toBeNull();
  });
});
