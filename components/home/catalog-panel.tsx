"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { PART_CATEGORIES } from "@/lib/copy";
import type { ClientSearchQuery } from "@/lib/search/public-offer";
import vehicles from "@/data/vehicles.json";

type Engine = { name: string; kw: number };
type Model = { name: string; yearFrom: number; yearTo: number | null; engines: Engine[] };
type Brand = { brand: string; models: Model[] };

const catalog = vehicles as Brand[];

function years(model: Model): string {
  return model.yearTo ? `${model.yearFrom}–${model.yearTo}` : `${model.yearFrom}–dosud`;
}

function modelKey(model: Model): string {
  return `${model.name}-${model.yearFrom}`;
}

export function CatalogPanel({ onSearch }: { onSearch: (query: ClientSearchQuery) => void }) {
  const [brandName, setBrandName] = useState("");
  const [modelId, setModelId] = useState("");
  const [engineId, setEngineId] = useState("");
  const [category, setCategory] = useState("");
  const [vin, setVin] = useState("");
  const [oem, setOem] = useState("");
  const [error, setError] = useState<string | null>(null);

  const brand = catalog.find((item) => item.brand === brandName) ?? null;
  const model = brand?.models.find((item) => modelKey(item) === modelId) ?? null;
  const engines = model?.engines ?? [];
  const engine = engineId === "" ? null : (engines[Number(engineId)] ?? null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const oemNumber = oem.trim();
    const vinValue = vin.trim();
    if (!oemNumber && !vinValue && !model) {
      setError("Vyberte model, nebo zadejte VIN či OEM.");
      return;
    }
    setError(null);
    const vehicle = model
      ? `${brandName} ${model.name} ${years(model)}${engine ? ` ${engine.name} ${engine.kw} kW` : ""}`
      : null;
    onSearch({
      oemNumber: oemNumber || null,
      vehicle,
      category: category || null,
      rawQuery: [vinValue ? `VIN ${vinValue}` : null, oemNumber || null].filter(Boolean).join(" ") || null,
      queryType: "catalog",
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <p className="sm:col-span-2 text-sm leading-6 text-muted">
        Místní výběr vozů, ne živý katalog výrobce. Kód motoru sem nepíšeme, když ho v podkladu nemáme. Doplníte ho do VIN
        nebo OEM, když ho znáte.
      </p>
      <label className="block text-sm font-semibold">
        Značka
        <select
          className="mt-1 w-full rounded-2xl border border-line bg-background px-3 py-2"
          value={brandName}
          onChange={(event) => {
            setBrandName(event.target.value);
            setModelId("");
            setEngineId("");
          }}
        >
          <option value="">Vyberte</option>
          {catalog.map((item) => (
            <option key={item.brand} value={item.brand}>
              {item.brand}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Model
        <select
          className="mt-1 w-full rounded-2xl border border-line bg-background px-3 py-2"
          value={modelId}
          disabled={!brand}
          onChange={(event) => {
            setModelId(event.target.value);
            setEngineId("");
          }}
        >
          <option value="">Vyberte</option>
          {brand?.models.map((item) => (
            <option key={modelKey(item)} value={modelKey(item)}>
              {item.name} {years(item)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Rok a motorizace
        <select
          className="mt-1 w-full rounded-2xl border border-line bg-background px-3 py-2"
          value={engineId}
          disabled={!model}
          onChange={(event) => setEngineId(event.target.value)}
        >
          <option value="">Bez upřesnění</option>
          {engines.map((item, index) => (
            <option key={`${item.name}-${item.kw}-${index}`} value={String(index)}>
              {item.name} · {item.kw} kW
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Kategorie
        <select className="mt-1 w-full rounded-2xl border border-line bg-background px-3 py-2" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">Bez kategorie</option>
          {PART_CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        VIN
        <input className="mt-1 w-full rounded-2xl border border-line bg-background px-3 py-2" value={vin} maxLength={17} onChange={(event) => setVin(event.target.value)} />
      </label>
      <label className="block text-sm font-semibold">
        OEM
        <input className="mt-1 w-full rounded-2xl border border-line bg-background px-3 py-2" value={oem} onChange={(event) => setOem(event.target.value)} />
      </label>
      {error ? <p className="text-sm font-semibold sm:col-span-2">{error}</p> : null}
      <div className="sm:col-span-2">
        <Button type="submit" variant="accent">
          Hledat v katalogu
        </Button>
      </div>
    </form>
  );
}
