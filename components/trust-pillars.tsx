"use client";

import { FileCheck, RotateCcw, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

const pillars: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ShieldCheck,
    title: "Ruční kontrola",
    text: "Každý díl kontroluje technik na provozovně.",
  },
  {
    icon: FileCheck,
    title: "Písemná záruka",
    text: "Funkčnost a kompatibilita se zárukou a fotoprotokolem z kontroly.",
  },
  {
    icon: Wrench,
    title: "Pečlivost",
    text: "Úchyty, lak, závity i elektronika bereme do detailu.",
  },
  {
    icon: RotateCcw,
    title: "Vrácení peněz",
    text: "Když díl při vstupní kontrole nevyhoví, blokaci uvolníme nebo zajistíme jiný kus.",
  },
];

export function TrustPillars() {
  const reduce = useReducedMotion();

  return (
    <section aria-label="Pilíře důvěry" className="border-t border-white/10">
      <ul className="mx-auto grid max-w-6xl gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        {pillars.map((pillar, index) => (
          <motion.li
            key={pillar.title}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: reduce ? 0 : index * 0.05 }}
            className="flex gap-3 rounded-2xl bg-white/5 px-3 py-3"
          >
            <pillar.icon className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="block font-display text-sm font-semibold">{pillar.title}</span>
              <span className="mt-1 block text-sm leading-5 text-white/75">{pillar.text}</span>
            </span>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
