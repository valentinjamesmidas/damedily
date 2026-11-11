import type { ReactNode } from "react";

export function LegalNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="max-w-2xl space-y-4">
      <h1 className="font-display text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="rounded-3xl border border-accent/40 bg-accent/10 px-5 py-4 text-sm leading-6">
        Tohle je zástupný text. Před ostrým provozem ho musí doplnit právník, včetně postupu reklamace a odstoupení od
        smlouvy do 14 dnů.
      </p>
      <div className="space-y-3 text-sm leading-6 text-muted">{children}</div>
    </article>
  );
}
