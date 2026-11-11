import type { Metadata } from "next";
import { LegalNote } from "@/components/legal-note";

export const metadata: Metadata = {
  title: "Reklamace",
};

export default function ClaimsPage() {
  return (
    <LegalNote title="Reklamace">
      <p>
        Reklamaci vyřizuje DámeDíly.cz jako prodávající. Konkrétní lhůty, adresu a postup doplní právník. Zákonná práva
        z vadného plnění tímhle textem neomezujeme.
      </p>
    </LegalNote>
  );
}
