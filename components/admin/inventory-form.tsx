"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { PART_CATEGORIES } from "@/lib/copy";
import type { AdminItem } from "@/lib/inventory/admin-item";
import {
  DIAMETERS,
  SEASONS,
  validateInventoryInput,
  type InventoryInput,
  type Placement,
  type ProjectTagValue,
} from "@/lib/inventory/item-input";
import type { ActionResult } from "@/lib/inventory/action-result";
import { sellingPrice } from "@/lib/pricing";

const fieldClass = "mt-1 w-full rounded-2xl border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent";

type FormState = {
  titleCs: string;
  oemNumber: string;
  partCategory: string;
  partCondition: "" | "pouzity" | "novy";
  conditionDetail: string;
  originKind: "" | "oem" | "druhovyroba";
  costPriceCzk: string;
  sellingPriceCzk: string;
  sellingTouched: boolean;
  stockQuantity: string;
  placementType: "" | Placement;
  internalProjectTag: "" | ProjectTagValue;
  vehicleText: string;
  images: string[];
  tireWidth: string;
  tireProfile: string;
  tireDiameter: "" | "R15C" | "R16C" | "R17C";
  tireLoadIndex: string;
  tireSeason: "" | "letni" | "zimni" | "celorocni";
};

function emptyState(): FormState {
  return {
    titleCs: "",
    oemNumber: "",
    partCategory: "",
    partCondition: "",
    conditionDetail: "",
    originKind: "",
    costPriceCzk: "",
    sellingPriceCzk: "",
    sellingTouched: false,
    stockQuantity: "1",
    placementType: "",
    internalProjectTag: "",
    vehicleText: "",
    images: [],
    tireWidth: "",
    tireProfile: "",
    tireDiameter: "",
    tireLoadIndex: "",
    tireSeason: "",
  };
}

function fromItem(item: AdminItem): FormState {
  return {
    titleCs: item.titleCs,
    oemNumber: item.oemNumber,
    partCategory: item.partCategory,
    partCondition: item.partCondition ?? "",
    conditionDetail: item.conditionDetail,
    originKind: item.originKind ?? "",
    costPriceCzk: String(item.costPriceCzk),
    sellingPriceCzk: String(item.sellingPriceCzk),
    sellingTouched: true,
    stockQuantity: String(item.stockQuantity),
    placementType: item.placementType,
    internalProjectTag: item.internalProjectTag,
    vehicleText: item.vehicleText,
    images: item.images,
    tireWidth: item.tireSpecs ? String(item.tireSpecs.width) : "",
    tireProfile: item.tireSpecs ? String(item.tireSpecs.profile) : "",
    tireDiameter: item.tireSpecs?.diameter ?? "",
    tireLoadIndex: item.tireSpecs?.loadIndex ?? "",
    tireSeason: item.tireSpecs?.season ?? "",
  };
}

function moneyOrNull(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
  const match = dataUrl.match(/^data:image\/(?:jpeg|png);base64,(.+)$/);
  return match?.[1] ?? "";
}

export function InventoryForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: AdminItem | null;
  onSubmit: (value: InventoryInput, files: File[]) => Promise<ActionResult>;
  onCancel?: () => void;
}) {
  const [state, setState] = useState<FormState>(() => (initial ? fromItem(initial) : emptyState()));
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function patch(partial: Partial<FormState>) {
    setState((current) => ({ ...current, ...partial }));
  }

  function updateCost(value: string) {
    const parsed = moneyOrNull(value);
    setState((current) => ({
      ...current,
      costPriceCzk: value,
      sellingPriceCzk:
        current.sellingTouched || parsed === null ? current.sellingPriceCzk : String(sellingPrice(parsed)),
    }));
  }

  async function prefill() {
    const file = files[0];
    if (!file) {
      setNotice("Nejdřív vyberte fotku. Když model neodpoví, kartu vyplňte ručně.");
      return;
    }
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setNotice("Předvyplnění umí JPEG a PNG. WebP uložíte jako fotku a údaje vyplňte ručně.");
      return;
    }
    setNotice("Čtu fotku…");
    setError(null);
    try {
      const data = await fileToBase64(file);
      const response = await fetch("/api/admin/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaType: file.type, data }),
      });
      const body = (await response.json()) as { ok?: boolean; message?: string; titleCs?: string | null; oemNumber?: string | null; partCategory?: string | null };
      if (!body.ok) {
        setNotice(body.message || "Předvyplnění se nepovedlo. Kartu vyplňte ručně.");
        return;
      }
      setState((current) => ({
        ...current,
        titleCs: body.titleCs || current.titleCs,
        oemNumber: body.oemNumber || current.oemNumber,
        partCategory: body.partCategory || current.partCategory,
      }));
      setNotice("Z fotky je doplněné jen to, co šlo přečíst. Zkontrolujte to a klidně přepište.");
    } catch {
      setNotice("Předvyplnění se nepovedlo. Kartu vyplňte ručně.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = validateInventoryInput({
      id: initial?.id ?? null,
      titleCs: state.titleCs,
      oemNumber: state.oemNumber,
      partCategory: state.partCategory,
      partCondition: state.partCondition,
      conditionDetail: state.conditionDetail,
      originKind: state.originKind || null,
      costPriceCzk: state.costPriceCzk,
      sellingPriceCzk: state.sellingPriceCzk === "" ? null : state.sellingPriceCzk,
      stockQuantity: state.stockQuantity,
      placementType: state.placementType,
      internalProjectTag: state.internalProjectTag,
      images: state.images,
      vehicleText: state.vehicleText,
      tireSpecs:
        state.placementType === "van_tires"
          ? {
              width: state.tireWidth,
              profile: state.tireProfile,
              diameter: state.tireDiameter,
              loadIndex: state.tireLoadIndex,
              season: state.tireSeason,
            }
          : null,
    });
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setPending(true);
    setError(null);
    const result = await onSubmit(parsed.value, files);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice("Položka je uložená.");
    setFiles([]);
    if (!initial) setState(emptyState());
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-3xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-semibold">{initial ? "Upravit položku" : "Nová položka"}</h2>
        <Button type="button" variant="outline" size="sm" onClick={() => void prefill()}>
          Předvyplnit z fotky
        </Button>
      </div>

      <label className="block text-sm font-semibold">
        Název
        <input className={fieldClass} value={state.titleCs} onChange={(event) => patch({ titleCs: event.target.value })} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          OEM
          <input className={fieldClass} value={state.oemNumber} onChange={(event) => patch({ oemNumber: event.target.value })} />
        </label>
        <label className="block text-sm font-semibold">
          Kategorie
          <input
            className={fieldClass}
            list="kategorie-dilu"
            value={state.partCategory}
            onChange={(event) => patch({ partCategory: event.target.value })}
          />
          <datalist id="kategorie-dilu">
            {PART_CATEGORIES.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold">Stav</legend>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="stav" checked={state.partCondition === "novy"} onChange={() => patch({ partCondition: "novy" })} />
            Nový
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="stav" checked={state.partCondition === "pouzity"} onChange={() => patch({ partCondition: "pouzity" })} />
            Použitý
          </label>
        </div>
      </fieldset>
      <label className="block text-sm font-semibold">
        Popis stavu
        <textarea className={fieldClass} rows={3} value={state.conditionDetail} onChange={(event) => patch({ conditionDetail: event.target.value })} />
      </label>
      <label className="block text-sm font-semibold">
        Původ
        <select className={fieldClass} value={state.originKind} onChange={(event) => patch({ originKind: event.target.value as FormState["originKind"] })}>
          <option value="">V podkladu neuvedeno</option>
          <option value="oem">OEM</option>
          <option value="druhovyroba">Druhovýroba</option>
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-semibold">
          Nákupní cena (Kč)
          <input className={fieldClass} inputMode="decimal" value={state.costPriceCzk} onChange={(event) => updateCost(event.target.value)} />
        </label>
        <label className="block text-sm font-semibold">
          Prodejní cena (Kč)
          <input
            className={fieldClass}
            inputMode="decimal"
            value={state.sellingPriceCzk}
            onChange={(event) => patch({ sellingPriceCzk: event.target.value, sellingTouched: true })}
          />
        </label>
        <label className="block text-sm font-semibold">
          Počet
          <input className={fieldClass} inputMode="numeric" value={state.stockQuantity} onChange={(event) => patch({ stockQuantity: event.target.value })} />
        </label>
      </div>
      <p className="text-xs leading-5 text-muted">Prodejní cena se z nákupní předvyplní. Můžete ji přepsat.</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const parsed = moneyOrNull(state.costPriceCzk);
          if (parsed === null) return;
          patch({ sellingPriceCzk: String(sellingPrice(parsed)), sellingTouched: false });
        }}
      >
        Přepočítat z nákupní ceny
      </Button>

      <fieldset>
        <legend className="text-sm font-semibold">Umístění</legend>
        <div className="mt-2 flex flex-col gap-2 text-sm">
          {(
            [
              ["action_offer", "Akční nabídka"],
              ["permanent_offer", "Stálá nabídka"],
              ["van_tires", "Pneu (Dodávky)"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="inline-flex items-center gap-2">
              <input type="radio" name="umisteni" checked={state.placementType === value} onChange={() => patch({ placementType: value })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {state.placementType === "van_tires" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Šířka
            <input className={fieldClass} inputMode="numeric" value={state.tireWidth} onChange={(event) => patch({ tireWidth: event.target.value })} />
          </label>
          <label className="block text-sm font-semibold">
            Profil
            <input className={fieldClass} inputMode="numeric" value={state.tireProfile} onChange={(event) => patch({ tireProfile: event.target.value })} />
          </label>
          <label className="block text-sm font-semibold">
            Průměr
            <select className={fieldClass} value={state.tireDiameter} onChange={(event) => patch({ tireDiameter: event.target.value as FormState["tireDiameter"] })}>
              <option value="">Vyberte</option>
              {DIAMETERS.map((diameter) => (
                <option key={diameter} value={diameter}>
                  {diameter}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Zátěžový index
            <input className={fieldClass} value={state.tireLoadIndex} onChange={(event) => patch({ tireLoadIndex: event.target.value })} />
          </label>
          <label className="block text-sm font-semibold sm:col-span-2">
            Období
            <select className={fieldClass} value={state.tireSeason} onChange={(event) => patch({ tireSeason: event.target.value as FormState["tireSeason"] })}>
              <option value="">Vyberte</option>
              {SEASONS.map((season) => (
                <option key={season} value={season}>
                  {season === "letni" ? "Letní" : season === "zimni" ? "Zimní" : "Celoroční"}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <fieldset>
        <legend className="text-sm font-semibold">Projekt</legend>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="projekt"
              checked={state.internalProjectTag === "ekokladno"}
              onChange={() => patch({ internalProjectTag: "ekokladno" })}
            />
            EKOKLADNO
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name="projekt"
              checked={state.internalProjectTag === "damedily"}
              onChange={() => patch({ internalProjectTag: "damedily" })}
            />
            DAMEDILY
          </label>
        </div>
      </fieldset>

      <label className="block text-sm font-semibold">
        Vozidla
        <input className={fieldClass} value={state.vehicleText} onChange={(event) => patch({ vehicleText: event.target.value })} placeholder="Třeba Škoda Octavia 2013–2020" />
      </label>
      <div className="block text-sm font-semibold">
        Fotky
        <input
          id="sklad-fotky"
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
        <label htmlFor="sklad-fotky" className="mt-1 inline-flex h-9 cursor-pointer items-center rounded-full border border-line bg-background px-3 text-sm font-semibold">
          Vybrat fotky
        </label>
        <p className="mt-1 text-xs font-normal text-muted">
          {files.length > 0 ? files.map((file) => file.name).join(", ") : "JPEG, PNG nebo WebP, nejvýš 5 MB."}
        </p>
      </div>
      {state.images.length > 0 ? <p className="text-xs text-muted">Uložené fotky: {state.images.length}. Nový výběr je přidá.</p> : null}

      {error ? (
        <p role="alert" className="rounded-2xl bg-accent/15 px-3 py-2 text-sm font-semibold">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-sm leading-6 text-muted">{notice}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="accent" disabled={pending}>
          {pending ? "Ukládám…" : "Uložit položku"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Zrušit úpravu
          </Button>
        ) : null}
      </div>
    </form>
  );
}
