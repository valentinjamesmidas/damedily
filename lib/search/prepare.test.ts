import { describe, expect, it } from "vitest";

import { TtlCache } from "@/lib/search/cache";
import { createListingTranslator } from "@/lib/search/prepare";
import type { SupplierListing } from "@/lib/search/types";
import type { XaiClient } from "@/lib/xai-grok";

const listing: SupplierListing = {
  sourcePlatform: "ovoko",
  externalId: "1",
  sourceUrl: "https://cdn.example/item",
  title: "Front brake disc",
  description: "Used, light wear.",
  oemNumber: "1K0615301",
  condition: "pouzity",
  conditionDetail: null,
  originKind: null,
  price: 40,
  currency: "EUR",
  imageUrls: [],
  supplierLeadTime: null,
  category: null,
};

describe("překlad inzerátu", () => {
  it("úspěšný překlad uloží a podruhé model nevolá", async () => {
    let calls = 0;
    const client = {
      async chatJson() {
        calls += 1;
        return {
          titleCs: "Přední brzdový kotouč",
          descriptionCs: "Použitý, lehké opotřebení.",
          condition: null,
          conditionDetail: null,
          originKind: null,
          oemNumber: null,
        };
      },
    } as unknown as XaiClient;
    const translate = createListingTranslator(client, new TtlCache(() => 1_000), 5_000);
    const first = await translate(listing);
    const second = await translate(listing);
    expect(first?.titleCs).toBe("Přední brzdový kotouč");
    expect(second?.titleCs).toBe(first?.titleCs);
    expect(calls).toBe(1);
  });

  it("selhání modelu neukládá, aby šel překlad zkusit znovu", async () => {
    let calls = 0;
    const client = {
      async chatJson() {
        calls += 1;
        throw new Error("402");
      },
    } as unknown as XaiClient;
    const translate = createListingTranslator(client, new TtlCache());
    expect(await translate(listing)).toBeNull();
    expect(await translate(listing)).toBeNull();
    expect(calls).toBe(2);
  });
});