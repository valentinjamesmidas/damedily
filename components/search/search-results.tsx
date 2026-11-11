"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ALTERNATIVE_NOTICE } from "@/lib/copy";
import {
  isStreamCompleted,
  readOfferEvent,
  readStreamError,
  takeSseEvents,
  type ClientSearchQuery,
} from "@/lib/search/public-offer";
import { OfferCard } from "@/components/search/offer-card";

export function SearchResults({ query }: { query: ClientSearchQuery }) {
  const reduce = useReducedMotion();
  const [offers, setOffers] = useState<{ key: string; phase: "first" | "alternative"; title: string; card: Parameters<typeof OfferCard>[0]["item"] }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const { oemNumber, vehicle, category, rawQuery, queryType } = query;

  useEffect(() => {
    const controller = new AbortController();
    const current = { oemNumber, vehicle, category, rawQuery, queryType };
    setOffers([]);
    setNotice(null);
    setError(null);
    setDone(false);

    const run = async () => {
      try {
        const response = await fetch("/api/search/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(current),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          setError("Hledání teď nejde spustit. Mrkněte na sklad níže.");
          setDone(true);
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = takeSseEvents(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            const offer = readOfferEvent(event);
            if (offer) {
              if (offer.phase === "alternative") setNotice(ALTERNATIVE_NOTICE);
              setOffers((current) => [
                ...current,
                {
                  key: `${offer.phase}-${current.length}-${offer.offer.oemNumber ?? offer.offer.titleCs}`,
                  phase: offer.phase,
                  title: offer.offer.titleCs,
                  card: {
                    title: offer.offer.titleCs,
                    conditionLabel: offer.offer.conditionLabel,
                    originLabel: offer.offer.originLabel,
                    conditionDetail: offer.offer.conditionDetail,
                    oemNumber: offer.offer.oemNumber,
                    priceCzk: offer.offer.sellingPriceCzk,
                    deliveryLeadTime: offer.offer.deliveryLeadTime,
                    imageUrl: offer.offer.images[0] ?? null,
                  },
                },
              ]);
            }
            const failure = readStreamError(event);
            if (failure) setError(failure);
            if (isStreamCompleted(event)) setDone(true);
          }
        }
        setDone(true);
      } catch {
        if (!controller.signal.aborted) {
          setError("Hledání se přerušilo. Zkuste to znovu, nebo se podívejte na sklad.");
          setDone(true);
        }
      }
    };

    void run();
    return () => controller.abort();
  }, [oemNumber, vehicle, category, rawQuery, queryType]);

  return (
    <section aria-live="polite" aria-label="Výsledky hledání" className="space-y-4">
      <h2 className="font-display text-2xl font-semibold">Ověřené nabídky</h2>
      {notice ? (
        <motion.p
          key={offers.length}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-accent/15 px-4 py-3 text-sm font-semibold text-primary"
        >
          {notice}
        </motion.p>
      ) : null}
      {error ? <p className="text-sm text-muted">{error}</p> : null}
      {done && offers.length === 0 && !error ? (
        <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-6 text-sm leading-6 text-muted">
          Ověřenou nabídku teď nemáme. Externí zdroje často nic nevrátí. Mrkněte na vlastní sklad níže, ten je na
          provozovně.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {offers.map((offer) => (
          <OfferCard key={offer.key} item={offer.card} />
        ))}
      </div>
    </section>
  );
}
