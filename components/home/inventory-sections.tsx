"use client";

import { useMemo, useState } from "react";
import { OfferCard } from "@/components/search/offer-card";
import { INSPECTION_SEAL } from "@/lib/copy";
import type { PublicStockItem } from "@/lib/inventory/public";
import { displayableImages } from "@/lib/inventory/public";
import { publicSupabaseEnv } from "@/lib/supabase/env";
import { OWN_STOCK_AVAILABILITY } from "@/lib/white-label";

const DIAMETERS = ["R15C", "R16C", "R17C"] as const;
const SEASONS = [
  ["letni", "Letní"],
  ["zimni", "Zimní"],
  ["celorocni", "Celoroční"],
] as const;

function conditionLabel(value: PublicStockItem["partCondition"]): string {
  if (value === "pouzity") return "Použitý";
  if (value === "novy") return "Nový";
  return "Stav v evidenci neuveden";
}

function originLabel(value: PublicStockItem["originKind"]): string | null {
  if (value === "oem") return "OEM";
  if (value === "druhovyroba") return "Druhovýroba";
  return null;
}

function StockGrid({ items, badge }: { items: PublicStockItem[]; badge?: string }) {
  const supabaseUrl = publicSupabaseEnv()?.url ?? null;
  if (items.length === 0) {
    return (
      <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-6 text-sm leading-6 text-muted">
        Ve skladu teď nic z téhle nabídky není. Až kus naskladníme, objeví se tady i s cenou a stavem.
      </p>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <OfferCard
          key={item.id}
          item={{
            title: item.titleCs,
            conditionLabel: conditionLabel(item.partCondition),
            originLabel: originLabel(item.originKind),
            conditionDetail: item.conditionDetail,
            oemNumber: item.oemNumber,
            priceCzk: item.sellingPriceCzk,
            deliveryLeadTime: OWN_STOCK_AVAILABILITY,
            badge,
            imageUrl: displayableImages(item.images, supabaseUrl)[0] ?? null,
          }}
        />
      ))}
    </div>
  );
}

export function InventorySections({ items }: { items: PublicStockItem[] }) {
  const action = items.filter((item) => item.placementType === "action_offer");
  const permanent = items.filter((item) => item.placementType === "permanent_offer");
  const tires = items.filter((item) => item.placementType === "van_tires");
  const [width, setWidth] = useState("");
  const [profile, setProfile] = useState("");
  const [diameter, setDiameter] = useState("");
  const [season, setSeason] = useState("");

  const widths = useMemo(() => uniqueNumbers(tires.map((item) => item.tireSpecs?.width)), [tires]);
  const profiles = useMemo(() => uniqueNumbers(tires.map((item) => item.tireSpecs?.profile)), [tires]);
  const filtered = tires.filter((item) => {
    const specs = item.tireSpecs;
    if (!specs) return false;
    if (width && specs.width !== Number(width)) return false;
    if (profile && specs.profile !== Number(profile)) return false;
    if (diameter && specs.diameter !== diameter) return false;
    if (season && specs.season !== season) return false;
    return true;
  });

  return (
    <div className="space-y-12">
      <section id="akcni" className="scroll-mt-6 space-y-4">
        <h2 className="font-display text-3xl font-semibold">Akční nabídka</h2>
        <p className="w-fit rounded-full bg-accent px-3 py-1 text-xs font-semibold tracking-wide text-primary">
          AKČNÍ NABÍDKA – IHNED K ODBĚRU
        </p>
        <StockGrid items={action} badge="AKČNÍ NABÍDKA – IHNED K ODBĚRU" />
      </section>
      <section id="stala" className="scroll-mt-6 space-y-4">
        <h2 className="font-display text-3xl font-semibold">Stálá nabídka</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted">Kusy, které držíme na provozovně k expedici.</p>
        <StockGrid items={permanent} />
      </section>
      <section id="pneu" className="scroll-mt-6 space-y-4">
        <h2 className="font-display text-3xl font-semibold">Pneu pro dodávky – Skladem</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Ducato, Boxer, Jumper, Sprinter, Crafter, Transporter, Transit, Master a Daily. Filtr je podle toho, co
          opravdu leží u nás.
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Select label="Šířka" value={width} onChange={setWidth} options={widths.map((value) => [String(value), String(value)])} />
          <Select label="Profil" value={profile} onChange={setProfile} options={profiles.map((value) => [String(value), String(value)])} />
          <Select label="Průměr" value={diameter} onChange={setDiameter} options={DIAMETERS.map((value) => [value, value])} />
          <Select label="Období" value={season} onChange={setSeason} options={SEASONS.map(([value, label]) => [value, label])} />
        </div>
        {tires.length > 0 && filtered.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-6 text-sm text-muted">
            Tomuto rozměru teď žádná pneu skladem neodpovídá.
          </p>
        ) : (
          <StockGrid items={filtered} />
        )}
        <p className="text-xs text-muted">{INSPECTION_SEAL}</p>
      </section>
    </div>
  );
}

function uniqueNumbers(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === "number"))].sort((a, b) => a - b);
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <label className="block text-sm font-semibold">
      {label}
      <select className="mt-1 w-full rounded-2xl border border-line bg-card px-3 py-2" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Vše</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
