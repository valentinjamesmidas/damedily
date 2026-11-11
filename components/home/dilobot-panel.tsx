"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { ClientSearchQuery } from "@/lib/search/public-offer";

type Turn = { role: "user" | "assistant"; content: string };

export function DilobotPanel({ onSearch, onOpenCatalog }: { onSearch: (query: ClientSearchQuery) => void; onOpenCatalog: () => void }) {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || pending) return;
    const history = [...turns, { role: "user" as const, content }].slice(-12);
    setTurns(history);
    setDraft("");
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/dilobot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (response.status === 503) {
        setNotice("Dílobot teď není dostupný. Můžete pokračovat v katalogu nebo zadat OEM.");
        setPending(false);
        return;
      }
      if (!response.ok || !response.body) {
        setNotice("Dílobot teď neodpověděl. Můžete pokračovat v katalogu nebo zadat OEM.");
        setPending(false);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      let failed = false;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((item) => item.startsWith("data:"));
          if (!line) continue;
          let event: { type?: string; text?: string; message?: string };
          try {
            event = JSON.parse(line.slice(5).trim()) as { type?: string; text?: string; message?: string };
          } catch {
            continue;
          }
          if (event.type === "text" && event.text) {
            reply += event.text;
            const snapshot = reply;
            setTurns([...history, { role: "assistant", content: snapshot }]);
          }
          if (event.type === "error") {
            failed = true;
            setNotice(event.message || "Dílobot teď neodpověděl. Můžete pokračovat v katalogu nebo zadat OEM.");
          }
        }
      }
      if (!failed && reply.trim()) {
        const full = [...history, { role: "assistant" as const, content: reply }];
        const turn = await fetch("/api/dilobot/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: full }),
        });
        if (turn.ok) {
          const body = (await turn.json()) as {
            readyForSearch?: boolean;
            specification?: { vehicle?: string | null; part?: string | null; oemNumber?: string | null } | null;
          };
          if (body.readyForSearch) {
            onSearch({
              oemNumber: body.specification?.oemNumber ?? null,
              vehicle: body.specification?.vehicle ?? null,
              category: body.specification?.part ?? null,
              rawQuery: content,
              queryType: "chat",
            });
          }
        } else {
          setNotice("Odpověď je výše. Specifikaci se nepodařilo ověřit, zkuste katalog nebo OEM.");
        }
      }
    } catch {
      setNotice("Dílobot teď neodpověděl. Můžete pokračovat v katalogu nebo zadat OEM.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted">
        Dílobot je AI asistent DámeDíly.cz. Ptá se jen na to, co k dílu chybí, a když to jde, spustí hledání.
      </p>
      <ol className="max-h-64 space-y-2 overflow-y-auto" aria-live="polite">
        {turns.map((turn, index) => (
          <li key={`${turn.role}-${index}`} className={`rounded-2xl px-3 py-2 text-sm leading-6 ${turn.role === "user" ? "bg-primary text-white" : "bg-background"}`}>
            {turn.content}
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="dilobot-zprava">
          Zpráva Dílobotovi
        </label>
        <input
          id="dilobot-zprava"
          className="min-w-0 flex-1 rounded-2xl border border-line bg-background px-3 py-2 text-sm"
          value={draft}
          placeholder="Třeba přední kotouče na Octavii 2016"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" variant="accent" disabled={pending || !draft.trim()}>
          {pending ? "Píše…" : "Odeslat"}
        </Button>
      </form>
      {notice ? (
        <div className="rounded-2xl bg-accent/15 px-3 py-3 text-sm leading-6">
          <p>{notice}</p>
          <button type="button" className="mt-2 font-semibold text-primary underline" onClick={onOpenCatalog}>
            Otevřít katalog
          </button>
        </div>
      ) : null}
    </div>
  );
}
