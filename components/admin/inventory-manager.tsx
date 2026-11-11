"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { InventoryForm } from "@/components/admin/inventory-form";
import { Button } from "@/components/ui/button";
import { deleteInventoryItem, saveInventoryItem } from "@/app/admin/actions";
import { formatCzk } from "@/lib/copy";
import type { AdminItem } from "@/lib/inventory/admin-item";
import type { InventoryInput, Placement, ProjectTagValue } from "@/lib/inventory/item-input";

const TAGS: { value: "" | ProjectTagValue; label: string }[] = [
  { value: "", label: "Všechny projekty" },
  { value: "ekokladno", label: "EKOKLADNO" },
  { value: "damedily", label: "DAMEDILY" },
];

const PLACEMENTS: { value: "" | Placement; label: string }[] = [
  { value: "", label: "Všechna umístění" },
  { value: "action_offer", label: "Akční nabídka" },
  { value: "permanent_offer", label: "Stálá nabídka" },
  { value: "van_tires", label: "Pneu (Dodávky)" },
];

function placementLabel(value: Placement): string {
  if (value === "action_offer") return "Akční nabídka";
  if (value === "permanent_offer") return "Stálá nabídka";
  return "Pneu (Dodávky)";
}

export function InventoryManager({ items, loadError }: { items: AdminItem[]; loadError: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminItem | null>(null);
  const [tag, setTag] = useState<"" | ProjectTagValue>("");
  const [placement, setPlacement] = useState<"" | Placement>("");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("cs-CZ");
    return items.filter((item) => {
      if (tag && item.internalProjectTag !== tag) return false;
      if (placement && item.placementType !== placement) return false;
      if (!needle) return true;
      return `${item.titleCs} ${item.oemNumber}`.toLocaleLowerCase("cs-CZ").includes(needle);
    });
  }, [items, placement, query, tag]);

  async function submit(value: InventoryInput, files: File[]) {
    const form = new FormData();
    form.set("payload", JSON.stringify(value));
    for (const file of files) form.append("photos", file);
    const result = await saveInventoryItem(form);
    if (result.ok) {
      setEditing(null);
      setMessage("Uložené.");
      router.refresh();
    }
    return result;
  }

  async function remove(item: AdminItem) {
    if (!window.confirm(`Smazat ${item.titleCs}?`)) return;
    const result = await deleteInventoryItem(item.id);
    setMessage(result.ok ? "Smazané." : result.message);
    if (result.ok) router.refresh();
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-accent">Jen role admin</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Sklad</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Nákupní cena a projekt jsou vidět jen tady. Na webu pro zákazníky nejsou.
        </p>
      </div>

      {loadError ? (
        <p role="alert" className="rounded-2xl bg-accent/15 px-4 py-3 text-sm">
          Sklad se nepodařilo načíst. Zápis může přesto projít, když jste administrátor.
        </p>
      ) : null}
      {message ? <p className="text-sm font-semibold">{message}</p> : null}

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {TAGS.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={tag === item.value}
              onClick={() => setTag(item.value)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${tag === item.value ? "bg-primary text-white" : "bg-card text-primary ring-1 ring-line"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {PLACEMENTS.map((item) => (
            <button
              key={item.label}
              type="button"
              aria-pressed={placement === item.value}
              onClick={() => setPlacement(item.value)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${placement === item.value ? "bg-accent text-primary" : "bg-card text-primary ring-1 ring-line"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="block max-w-md text-sm font-semibold">
          Hledat název nebo OEM
          <input
            className="mt-1 w-full rounded-2xl border border-line bg-card px-3 py-2 text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-6 text-sm text-muted">
          Tomuto filtru žádná položka neodpovídá.
        </p>
      ) : (
        <ul className="grid gap-3">
          {visible.map((item) => (
            <li key={item.id} className="rounded-3xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-semibold">{item.titleCs}</p>
                  <p className="mt-1 text-sm text-muted">
                    OEM {item.oemNumber} · {placementLabel(item.placementType)} · {item.stockQuantity} ks
                  </p>
                  <p className="mt-1 text-sm">
                    Nákup {formatCzk(item.costPriceCzk)} · Prodej {formatCzk(item.sellingPriceCzk)} ·{" "}
                    {item.internalProjectTag === "ekokladno" ? "EKOKLADNO" : "DAMEDILY"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(item)}>
                    Upravit
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void remove(item)}>
                    Smazat
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <InventoryForm key={editing?.id ?? "new"} initial={editing} onSubmit={submit} onCancel={editing ? () => setEditing(null) : undefined} />
    </div>
  );
}
