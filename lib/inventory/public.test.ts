import { describe, expect, it } from "vitest";
import { isOwnInventoryImage, parsePublicStock } from "./public";

describe("veřejný sklad", () => {
  it("z odpovědi zahodí nákupní cenu, tag i zdroj", () => {
    const [item] = parsePublicStock([
      {
        id: "10000000-0000-4000-8000-000000000001",
        title_cs: "[UKÁZKA] Kotouč",
        oem_number: "1K0615301",
        part_category: "Brzdy",
        selling_price_czk: "2100.00",
        stock_quantity: 2,
        placement_type: "action_offer",
        images: [],
        part_condition: "novy",
        origin_kind: "druhovyroba",
        condition_detail: "Nový.",
        cost_price_czk: 1400,
        internal_project_tag: "ekokladno",
        source_platform: "ovoko",
      },
    ]);
    expect(item?.sellingPriceCzk).toBe(2100);
    expect(item?.partCondition).toBe("novy");
    const json = JSON.stringify(item);
    expect(json).not.toContain("cost_price");
    expect(json).not.toContain("ekokladno");
    expect(json).not.toContain("ovoko");
    expect(json).not.toContain("internal_project_tag");
  });

  it("vezme jen naši fotku nebo relativní cestu", () => {
    expect(isOwnInventoryImage("/ukazka/kotouc.svg", null)).toBe(true);
    expect(isOwnInventoryImage("https://cdn.example/ovoko.jpg", "http://127.0.0.1:54321")).toBe(false);
    expect(
      isOwnInventoryImage(
        "http://127.0.0.1:54321/storage/v1/object/public/inventory-images/a.jpg",
        "http://127.0.0.1:54321",
      ),
    ).toBe(true);
  });
});
