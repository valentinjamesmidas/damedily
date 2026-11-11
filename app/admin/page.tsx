import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Administrace",
};

export default function AdminPage() {
  return (
    <div className="max-w-2xl">
      <p className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-accent">
        Jen role admin
      </p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">Administrace</h1>
      <p className="mt-4 text-lg leading-7 text-muted">
        Sklad, nákupní cena, interní tag a zdroj objednávky uvidí až přihlášený administrátor.
        Zákaznické stránky ty údaje neberou.
      </p>
      <div className="mt-8 rounded-3xl border border-dashed border-line bg-card px-5 py-6 text-sm leading-6 text-muted">
        Správa skladu a fronta ruční kontroly se sem doplní později. Teď tu není formulář, který by
        zapisoval do databáze.
      </div>
    </div>
  );
}
