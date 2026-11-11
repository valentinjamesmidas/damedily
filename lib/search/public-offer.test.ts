import { describe, expect, it } from "vitest";
import { readOfferEvent, readPublicOffer, takeSseEvents } from "./public-offer";

const offer = {
  titleCs: "Brzdový kotouč",
  descriptionCs: null,
  oemNumber: "1K0615301",
  condition: "novy",
  conditionLabel: "Nový",
  conditionDetail: "Nový, bez koroze.",
  originKind: "druhovyroba",
  originLabel: "Druhovýroba",
  warehouseLabel: "Externí nabídka – Sektor C",
  sellingPriceCzk: 2100,
  deliveryLeadTime: "4–5 pracovních dní",
  images: ["/api/media/x"],
  costPriceCzk: 1400,
  sourcePlatform: "autodoc",
  internalProjectTag: "damedily",
  aiScore: 0.91,
};

describe("veřejná nabídka ze streamu", () => {
  it("nepřevezme nákup, zdroj ani skóre", () => {
    const parsed = readPublicOffer(offer);
    const json = JSON.stringify(parsed);
    expect(parsed?.sellingPriceCzk).toBe(2100);
    expect(parsed?.deliveryLeadTime).toBe("4–5 pracovních dní");
    expect(json).not.toContain("costPrice");
    expect(json).not.toContain("autodoc");
    expect(json).not.toContain("damedily");
    expect(json).not.toContain("aiScore");
    expect(json).not.toContain("0.91");
  });

  it("z SSE vezme první nabídku a zbytek bufferu nechá", () => {
    const raw = `data: ${JSON.stringify({ type: "offer", phase: "first", offer })}\n\ndata: {"type":"status"`;
    const { events, rest } = takeSseEvents(raw);
    expect(readOfferEvent(events[0])?.phase).toBe("first");
    expect(rest).toContain("status");
  });
});
