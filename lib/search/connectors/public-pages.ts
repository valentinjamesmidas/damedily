import { detectPublicBlock } from "@/lib/search/block";
import { listingsFromJsonLd } from "@/lib/search/jsonld";
import { PoliteFetch } from "@/lib/search/polite-fetch";
import type { ConnectorResult, SupplierConnector, SupplierSearchQuery } from "@/lib/search/types";

function searchText(query: SupplierSearchQuery): string {
  return [query.oemNumber, query.vehicle, query.category, query.rawQuery]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .trim();
}

/**
 * Ovoko / RRR.lt. Veřejné hledání s `exact=1` robots.txt výslovně povoluje, `/api/` zakazuje.
 * Oficiální API je pro sklady prodejců, ne pro čtení nabídky bez smlouvy.
 */
export function createOvokoConnector(enabled: boolean, fetchPublic: PoliteFetch): SupplierConnector {
  return {
    source: "ovoko",
    enabled,
    async search(query) {
      if (!enabled) return skipped("ovoko", "vypnuto v konfiguraci");
      const text = searchText(query);
      if (!text) return empty("ovoko", "není podle čeho hledat");
      const url = `https://rrr.lt/en/search?${new URLSearchParams({ q: text, exact: "1" }).toString()}`;
      return readPublicListings("ovoko", url, fetchPublic);
    },
  };
}

/**
 * B-Parts. Veřejné API jsme nenašli. Stránka /auto-parts/search je v robots.txt povolená,
 * ale 11. 11. 2026 ji CloudFront naší identifikaci vrátil 403. Parametr dotazu není ověřený,
 * proto se k adrese nic nepřiřazuje a ze stránky se neberou cizí nabídky.
 */
export function createBPartsConnector(enabled: boolean, fetchPublic: PoliteFetch): SupplierConnector {
  return {
    source: "b_parts",
    enabled,
    async search() {
      if (!enabled) return skipped("b_parts", "vypnuto v konfiguraci");
      const page = await fetchPublic.fetchText("b_parts", "https://www.b-parts.com/auto-parts/search");
      if (page.outcome === "blocked") {
        return { source: "b_parts", listings: [], outcome: "blocked", detail: page.detail };
      }
      if (page.outcome !== "ok") {
        return { source: "b_parts", listings: [], outcome: page.outcome, detail: page.detail };
      }
      return {
        source: "b_parts",
        listings: [],
        outcome: "empty",
        detail: "stránka hledání neodmítla přístup, ale ověřený parametr dotazu není, takže z ní nebereme nabídky",
      };
    },
  };
}

/**
 * Autodoc. Prodejní API na Miraklu chce smlouvu a klíč. Veřejný web 11. 11. 2026
 * vrací Cloudflare challenge už na robots.txt, takže se nevolá žádná uhodnutá adresa hledání.
 */
export function createAutodocConnector(enabled: boolean, fetchPublic: PoliteFetch): SupplierConnector {
  return {
    source: "autodoc",
    enabled,
    async search() {
      if (!enabled) return skipped("autodoc", "vypnuto v konfiguraci");
      const page = await fetchPublic.fetchText("autodoc", "https://www.autodoc.cz/robots.txt");
      if (page.outcome === "blocked" || page.outcome === "error") {
        return { source: "autodoc", listings: [], outcome: "blocked", detail: page.detail };
      }
      const block = detectPublicBlock(page.status, page.body, null);
      if (block) return { source: "autodoc", listings: [], outcome: "blocked", detail: block };
      return {
        source: "autodoc",
        listings: [],
        outcome: "skipped",
        detail: "robots.txt šlo přečíst, ale ověřená veřejná adresa hledání bez smlouvy není",
      };
    },
  };
}

async function readPublicListings(
  source: "ovoko",
  url: string,
  fetchPublic: PoliteFetch,
): Promise<ConnectorResult> {
  const page = await fetchPublic.fetchText(source, url);
  if (page.outcome !== "ok") {
    return { source, listings: [], outcome: page.outcome, detail: page.detail };
  }
  const listings = listingsFromJsonLd(page.body, page.finalUrl, source);
  return {
    source,
    listings,
    outcome: listings.length > 0 ? "ok" : "empty",
    detail: listings.length > 0 ? "json-ld" : "veřejná stránka nemá strukturované nabídky",
  };
}

function skipped(source: ConnectorResult["source"], detail: string): ConnectorResult {
  return { source, listings: [], outcome: "skipped", detail };
}

function empty(source: ConnectorResult["source"], detail: string): ConnectorResult {
  return { source, listings: [], outcome: "empty", detail };
}
