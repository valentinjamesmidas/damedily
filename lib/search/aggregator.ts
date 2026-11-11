import type { ConnectorResult, SupplierConnector, SupplierSearchQuery } from "@/lib/search/types";

/**
 * Spustí zapnuté konektory a nic z jejich výstupu si nedomýšlí.
 * Vypnutý zdroj se ani nezavolá.
 */
export class SupplierAggregatorService {
  constructor(private readonly connectors: readonly SupplierConnector[]) {}

  enabled(): readonly SupplierConnector[] {
    return this.connectors.filter((connector) => connector.enabled);
  }

  disabled(): readonly SupplierConnector[] {
    return this.connectors.filter((connector) => !connector.enabled);
  }

  start(query: SupplierSearchQuery): Promise<ConnectorResult>[] {
    return this.enabled().map(async (connector) => {
      try {
        return await connector.search(query);
      } catch {
        return {
          source: connector.source,
          listings: [],
          outcome: "error" as const,
          detail: "konektor spadl",
        };
      }
    });
  }
}
