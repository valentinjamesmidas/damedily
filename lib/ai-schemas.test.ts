import { describe, expect, it } from "vitest";
import {
  dilobotTurnSchema,
  listingNormalizationSchema,
  publicHintFromVision,
  visionExtractionSchema,
} from "./ai-schemas";

const specification = {
  vehicle: "VW Transporter 2018",
  vin: null,
  engine: "2.0 TDI",
  part: "brzdové destičky",
  oemNumber: null,
};

describe("schémata Dílobota a inzerátu", () => {
  it("přijme nejvýše tři upřesňující otázky", () => {
    const parsed = dilobotTurnSchema.parse({
      replyCs: "Jaký je rok výroby?",
      questionsAsked: 3,
      specification,
      readyForSearch: false,
    });
    expect(parsed.questionsAsked).toBe(3);
  });

  it("odmítne čtvrtou otázku a prázdnou odpověď", () => {
    expect(
      dilobotTurnSchema.safeParse({
        replyCs: "Ještě jedna otázka?",
        questionsAsked: 4,
        specification: null,
        readyForSearch: false,
      }).success,
    ).toBe(false);
    expect(
      dilobotTurnSchema.safeParse({
        replyCs: "",
        questionsAsked: 0,
        specification: null,
        readyForSearch: false,
      }).success,
    ).toBe(false);
  });

  it("u inzerátu nechá neznámé údaje null a zahodí AI skóre", () => {
    const parsed = listingNormalizationSchema.parse({
      titleCs: "Brzdový kotouč",
      descriptionCs: null,
      condition: null,
      conditionDetail: null,
      originKind: null,
      oemNumber: null,
      aiScore: 0.91,
    });
    expect(parsed.condition).toBeNull();
    expect(parsed).not.toHaveProperty("aiScore");
  });

  it("nepřijme vymyšlený stav dílu", () => {
    expect(
      listingNormalizationSchema.safeParse({
        titleCs: "Kotouč",
        descriptionCs: null,
        condition: "repasovany",
        conditionDetail: null,
        originKind: "oem",
        oemNumber: null,
      }).success,
    ).toBe(false);
  });
});

describe("vision schéma", () => {
  it("drží jistotu mezi 0 a 1 a ve veřejném náhledu ji nemá", () => {
    const parsed = visionExtractionSchema.parse({
      oemNumbers: [{ value: "1K0698151", confidence: 0.8 }],
      partType: "brzdový kotouč",
      partTypeConfidence: 1,
    });
    const hint = publicHintFromVision(parsed);
    expect(hint).toEqual({ oemNumbers: ["1K0698151"], partType: "brzdový kotouč" });
    expect(JSON.stringify(hint)).not.toMatch(/confidence|jistota|aiScore|skore/i);
  });

  it("odmítne jistotu mimo rozsah a prázdné OEM", () => {
    expect(
      visionExtractionSchema.safeParse({
        oemNumbers: [{ value: "1K0", confidence: 1.01 }],
        partType: null,
        partTypeConfidence: 0,
      }).success,
    ).toBe(false);
    expect(
      visionExtractionSchema.safeParse({
        oemNumbers: [{ value: "", confidence: 0.2 }],
        partType: null,
        partTypeConfidence: 0,
      }).success,
    ).toBe(false);
  });
});
