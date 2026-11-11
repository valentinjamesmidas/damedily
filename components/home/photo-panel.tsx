"use client";

import { useState, type DragEvent, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { ClientSearchQuery } from "@/lib/search/public-offer";

export function PhotoPanel({ onSearch }: { onSearch: (query: ClientSearchQuery) => void }) {
  const [oem, setOem] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [partType, setPartType] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function read(file: File) {
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setHint("Čtení umí JPEG a PNG. OEM můžete napsat ručně.");
      return;
    }
    setPending(true);
    setHint(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(file);
      });
      const match = dataUrl.match(/^data:(image\/jpeg|image\/png);base64,(.+)$/);
      if (!match?.[1] || !match[2]) {
        setHint("Fotku se nepodařilo přečíst. OEM napište ručně.");
        return;
      }
      const response = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaType: match[1], data: match[2] }),
      });
      const body = (await response.json()) as { ok?: boolean; message?: string; oemNumbers?: string[]; partType?: string | null };
      if (!body.ok) {
        setHint(body.message || "Rozpoznání z fotky teď není dostupné. Zadejte OEM ručně.");
        return;
      }
      const first = body.oemNumbers?.[0] ?? "";
      if (first) setOem(first);
      setPartType(body.partType ?? null);
      setHint(
        first
          ? `Z fotky čteme OEM ${first}${body.partType ? ` a typ ${body.partType}` : ""}. Než spustíte hledání, zkontrolujte to.`
          : "Z fotky se nepodařilo jistě přečíst OEM. Zadejte ho ručně.",
      );
    } catch {
      setHint("Rozpoznání z fotky teď není dostupné. Zadejte OEM ručně.");
    } finally {
      setPending(false);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void read(file);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const oemNumber = oem.trim();
    if (!oemNumber && !partType) {
      setHint("Zadejte OEM ručně, nebo nechte přečíst fotku.");
      return;
    }
    onSearch({
      oemNumber: oemNumber || null,
      vehicle: null,
      category: partType,
      rawQuery: partType,
      queryType: "photo",
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        className="rounded-3xl border border-dashed border-line bg-background px-4 py-8 text-center"
      >
        <p className="text-sm font-semibold">Přetáhněte fotku štítku, nebo ji vyfoťte</p>
        <p className="mt-1 text-sm text-muted">JPEG nebo PNG. Když čtení selže, OEM zůstane na vás.</p>
        <label className="mt-4 inline-block text-sm font-semibold text-accent">
          Vybrat fotku
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void read(file);
            }}
          />
        </label>
      </div>
      <label className="block text-sm font-semibold">
        OEM ručně
        <input className="mt-1 w-full rounded-2xl border border-line bg-background px-3 py-2" value={oem} onChange={(event) => setOem(event.target.value)} />
      </label>
      {hint ? <p className="text-sm leading-6">{hint}</p> : null}
      <Button type="submit" variant="accent" disabled={pending}>
        {pending ? "Čtu fotku…" : "Hledat podle fotky"}
      </Button>
    </form>
  );
}
