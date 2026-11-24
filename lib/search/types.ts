import type { SourcePlatform } from "@/lib/white-label";

export type SearchQueryType = "chat" | "catalog" | "photo";

export type SupplierSearchQuery = {
  oemNumber: string | null;
  vehicle: string | null;
  category: string | null;
  rawQuery: string | null;
  queryType: SearchQueryType;
};

export type SupplierListing = {
  sourcePlatform: SourcePlatform;
  externalId: string;
  sourceUrl: string;
  title: string;
  description: string | null;
  oemNumber: string | null;
  condition: "pouzity" | "novy" | null;
  conditionDetail: string | null;
  originKind: "oem" | "druhovyroba" | null;
  price: number;
  /**
   * true jen u vlastního skladu: `price` je uložená prodejní cena v Kč.
   * Marže se z ní znovu nepočítá a nákupní cena v nabídce není.
   */
  priceIsSelling?: boolean;
  currency: string;
  imageUrls: string[];
  supplierLeadTime: string | null;
  category: string | null;
};

export type ConnectorOutcome = "ok" | "empty" | "blocked" | "skipped" | "error";

export type ConnectorResult = {
  source: SourcePlatform;
  listings: SupplierListing[];
  outcome: ConnectorOutcome;
  detail: string;
};

export type SearchLog = {
  source: SourcePlatform | "rates" | "session" | "rank";
  outcome: string;
  detail: string;
};

export interface SupplierConnector {
  readonly source: SourcePlatform;
  readonly enabled: boolean;
  search(query: SupplierSearchQuery): Promise<ConnectorResult>;
}
