import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Účet",
};

export default function AccountPage() {
  return (
    <div className="max-w-2xl">
      <p className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-accent">
        Klientská zóna
      </p>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">Můj účet</h1>
      <p className="mt-4 text-lg leading-7 text-muted">
        Přihlášení, objednávky, vozidla a faktury přijdou v dalším kroku. Tahle stránka je jen
        místo, kam se zóna připojí.
      </p>
      <ul className="mt-8 divide-y divide-line rounded-3xl border border-line bg-card">
        {["Objednávky a stav kontroly", "Moje garáž", "Faktury"].map((item) => (
          <li key={item} className="px-5 py-4 text-sm font-semibold">
            {item}
            <span className="mt-1 block font-normal text-muted">Zatím bez dat.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
