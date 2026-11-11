import { z } from "zod";

/** Specifikace, kterou Dílobot smí sestavit jen z toho, co zákazník řekl. */
export const partSpecificationSchema = z.object({
  vehicle: z.string().nullable(),
  vin: z.string().nullable(),
  engine: z.string().nullable(),
  part: z.string().nullable(),
  oemNumber: z.string().nullable(),
});

export type PartSpecification = z.infer<typeof partSpecificationSchema>;

/**
 * Jedna strukturovaná odpověď Dílobota.
 * questionsAsked je počet upřesňujících otázek v replyCs a nesmí překročit 3.
 */
export const dilobotTurnSchema = z.object({
  replyCs: z.string().min(1),
  questionsAsked: z.number().int().min(0).max(3),
  specification: partSpecificationSchema.nullable(),
  readyForSearch: z.boolean(),
});

export type DilobotTurn = z.infer<typeof dilobotTurnSchema>;

/** Překlad inzerátu. Null znamená, že údaj ve zdroji není. Nevymýšlí se. */
export const listingNormalizationSchema = z.object({
  titleCs: z.string().nullable(),
  descriptionCs: z.string().nullable(),
  condition: z.enum(["pouzity", "novy"]).nullable(),
  conditionDetail: z.string().nullable(),
  originKind: z.enum(["oem", "druhovyroba"]).nullable(),
  oemNumber: z.string().nullable(),
});

export type ListingNormalization = z.infer<typeof listingNormalizationSchema>;

/**
 * Interní pořadí alternativ. Model smí vrátit jen id, která dostal.
 * Skóre tu není, aby nemělo kam utéct do veřejné nabídky.
 */
export const offerRankingSchema = z.object({
  alternativeIds: z.array(z.string().min(1)).max(2),
});

export type OfferRanking = z.infer<typeof offerRankingSchema>;

const confidenceSchema = z.number().min(0).max(1);

/** Interní čtení fotky. Míra jistoty nesmí odejít do veřejné nabídky. */
export const visionExtractionSchema = z.object({
  oemNumbers: z.array(
    z.object({
      value: z.string().min(1),
      confidence: confidenceSchema,
    }),
  ),
  partType: z.string().nullable(),
  partTypeConfidence: confidenceSchema,
});

export type VisionExtraction = z.infer<typeof visionExtractionSchema>;

/** Veřejný náhled z vision. Jistota tu schválně není. */
export type PublicVisionHint = {
  oemNumbers: string[];
  partType: string | null;
};

export function publicHintFromVision(result: VisionExtraction): PublicVisionHint {
  return {
    oemNumbers: result.oemNumbers.map((item) => item.value),
    partType: result.partType,
  };
}
