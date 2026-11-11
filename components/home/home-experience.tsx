"use client";

import { useState } from "react";
import { CatalogPanel } from "@/components/home/catalog-panel";
import { DilobotPanel } from "@/components/home/dilobot-panel";
import { InventorySections } from "@/components/home/inventory-sections";
import { PhotoPanel } from "@/components/home/photo-panel";
import { SearchResults } from "@/components/search/search-results";
import { MIN_ORDER_CZK } from "@/lib/pricing";
import type { PublicStockItem } from "@/lib/inventory/public";
import type { ClientSearchQuery } from "@/lib/search/public-offer";

const tabs = [
  { id: "dilobot", label: "Dílobot" },
  { id: "katalog", label: "Katalog" },
  { id: "foto", label: "Foto" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function HomeExperience({ items }: { items: PublicStockItem[] }) {
  const [tab, setTab] = useState<TabId>("dilobot");
  const [query, setQuery] = useState<ClientSearchQuery | null>(null);

  return (
    <div className="space-y-14">
      <section className="grid items-start gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-accent">DámeDíly.cz</p>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Díly, které projdou našima rukama.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-7 text-muted">
            Dílobot je AI asistent. Z běžné řeči, katalogu nebo fotky sestaví poptávku. Co máme skladem, je na
            provozovně. Externí díl k vám nejede přímo: nejdřív jde na kontrolu, proto 4–5 pracovních dní.
          </p>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted">
            Minimální objednávka pro spuštění kontroly a expedice se zárukou je {MIN_ORDER_CZK.toLocaleString("cs-CZ")} Kč.
            Košík doplníme v dalším kroku.
          </p>
        </div>
        <div className="rounded-3xl border border-line bg-card p-4 sm:p-6">
          <div role="tablist" aria-label="Způsob hledání" className="grid grid-cols-3 gap-1 rounded-full bg-background p-1">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`tab-${item.id}`}
                aria-selected={tab === item.id}
                aria-controls={`panel-${item.id}`}
                className={`rounded-full px-2 py-2 text-sm font-semibold ${tab === item.id ? "bg-accent text-primary" : "text-muted"}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-5" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "dilobot" ? <DilobotPanel onSearch={setQuery} onOpenCatalog={() => setTab("katalog")} /> : null}
            {tab === "katalog" ? <CatalogPanel onSearch={setQuery} /> : null}
            {tab === "foto" ? <PhotoPanel onSearch={setQuery} /> : null}
          </div>
        </div>
      </section>
      {query ? <SearchResults query={query} /> : null}
      <InventorySections items={items} />
    </div>
  );
}
