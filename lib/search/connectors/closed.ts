import type { ConnectorResult, SupplierConnector } from "@/lib/search/types";

const INTER_CARS_DETAIL =
  "Veřejné API bez zákaznické smlouvy není. IC API se aktivuje přes Help Center a chce ClientId a ClientSecret. Hledání /vyhledavani/q= robots.txt na intercars.cz zakazuje, proto se nevolá.";

const AUTO_PARTNER_DETAIL =
  "CustomerAPI na customerapi.autopartner.dev je SOAP pro přihlášeného zákazníka. Firemní web cz.autopartner.com nemá veřejný ceník. Přihlášení nemáme a neobcházíme ho.";

/** Inter Cars. Bez smlouvy a bez požadavku na zakázanou adresu. */
export function createInterCarsConnector(enabled: boolean): SupplierConnector {
  return {
    source: "inter_cars",
    enabled,
    async search() {
      return closed("inter_cars", enabled, INTER_CARS_DETAIL);
    },
  };
}

/** Auto Partner. Bez smlouvy a bez požadavku na zákaznické API. */
export function createAutoPartnerConnector(enabled: boolean): SupplierConnector {
  return {
    source: "auto_partner",
    enabled,
    async search() {
      return closed("auto_partner", enabled, AUTO_PARTNER_DETAIL);
    },
  };
}

function closed(
  source: ConnectorResult["source"],
  enabled: boolean,
  detail: string,
): ConnectorResult {
  if (!enabled) return { source, listings: [], outcome: "skipped", detail: "vypnuto v konfiguraci" };
  return { source, listings: [], outcome: "skipped", detail };
}
