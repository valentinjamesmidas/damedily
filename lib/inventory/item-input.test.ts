import { describe, expect, it } from "vitest";
import { TAG_REQUIRED_MESSAGE } from "@/lib/copy";
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
  images: [],
  vehicleText: "",
  tireSpecs: null,
};

describe("validace skladové položky", () => {
  it("bez tagu neprojde a tag je první hláška", () => {
    const result = validateInventoryInput({ ...base, internalProjectTag: "" });
    expect(result).toEqual({ ok: false, message: TAG_REQUIRED_MESSAGE });
  });

  it("prázdnou prodejní cenu doplní z nákupní a ruční přepis nechá", () => {
    const filled = validateInventoryInput({ ...base, internalProjectTag: "damedily" });
    expect(filled.ok && filled.value.sellingPriceCzk).toBe(300);
    const override = validateInventoryInput({ ...base, internalProjectTag: "ekokladno", sellingPriceCzk: 450 });
    expect(override.ok && override.value.sellingPriceCzk).toBe(450);
  });

  it("u pneu vyžaduje rozměr a jinde specifikaci zahodí", () => {
    const missing = validateInventoryInput({ ...base, internalProjectTag: "damedily", placementType: "van_tires" });
    expect(missing.ok).toBe(false);
    const tire = validateInventoryInput({
      ...base,
      internalProjectTag: "damedily",
      placementType: "van_tires",
      tireSpecs: { width: 215, profile: 65, diameter: "R16C", loadIndex: "109/107", season: "letni" },
    });
    expect(tire.ok && tire.value.tireSpecs?.diameter).toBe("R16C");
    const other = validateInventoryInput({
      ...base,
      internalProjectTag: "damedily",
      tireSpecs: { width: 215, profile: 65, diameter: "R16C", loadIndex: "109/107", season: "letni" },
    });
    expect(other.ok && other.value.tireSpecs).toBeNull();
  });
});
