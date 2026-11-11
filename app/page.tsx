import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const sections = [
  {
    title: "Akční nabídka",
    text: "Díly fyzicky skladem k okamžitému odběru. Katalog se napojí v dalším kroku, teď tu žádné kusy nevystavujeme.",
  },
  {
    title: "Stálá nabídka",
    text: "Trvale skladem k expedici. Až bude sklad v databázi, uvidíte tu jen prodejní cenu a stav, ne nákupní cenu.",
  },
  {
    title: "Pneu pro dodávky",
    text: "Dodávkové pneu podle rozměru a sezóny. Výběr vozů a filtrů přijde se samotným katalogem.",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-12">
      <section className="grid items-end gap-8 border-b border-line pb-10 lg:grid-cols-[1.4fr_0.8fr]">
        <div>
          <p className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-accent">
            DámeDíly.cz
          </p>
          <h1 className="mt-3 max-w-xl font-display text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Díly, u kterých víte, kdo je zkontroloval.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-7 text-muted">
            Kostra obchodu je připravená. Vyhledávání, platby a napojení dodavatelů v tomhle kroku
            ještě nejsou. Nic z toho tu nepředstíráme.
          </p>
        </div>
        <div className="rounded-3xl border border-line bg-card p-6">
          <p className="font-display text-lg font-semibold">Minimální objednávka 2&nbsp;000&nbsp;Kč</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            Pod limitem se kontrola a expedice se zárukou nespustí. Výpočet prodejní ceny a
            chybějící částky je v <code className="text-primary">lib/pricing.ts</code>.
          </p>
          <Button asChild className="mt-5">
            <Link href="/ucet">
              Klientská zóna
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </section>

      <section aria-label="Připravované nabídky" className="grid gap-4 md:grid-cols-3">
        {sections.map((section) => (
          <article key={section.title} className="rounded-3xl border border-line bg-card p-5">
            <h2 className="font-display text-xl font-semibold">{section.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{section.text}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
