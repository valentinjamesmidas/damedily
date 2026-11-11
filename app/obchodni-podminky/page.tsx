import type { Metadata } from "next";
import { LegalNote } from "@/components/legal-note";

export const metadata: Metadata = {
  title: "Obchodní podmínky",
};

export default function TermsPage() {
  return (
    <LegalNote title="Obchodní podmínky">
      <p>
        Prodávajícím je DámeDíly.cz. Identifikace firmy, IČO a sídlo sem patří, ale v tomhle kroku je nemáme ověřené,
        takže je sem nedoplňujeme.
      </p>
    </LegalNote>
  );
}
