import type { Metadata } from "next";
import { LegalNote } from "@/components/legal-note";

export const metadata: Metadata = {
  title: "Odstoupení do 14 dnů",
};

export default function WithdrawalPage() {
  return (
    <LegalNote title="Odstoupení do 14 dnů">
      <p>
        Spotřebitel může od smlouvy odstoupit do 14 dnů. Vzorový formulář a výjimky, třeba u zboží vyrobeného na
        zakázku, doplní právník. Tady je jen místo, kam odkaz z patičky míří.
      </p>
    </LegalNote>
  );
}
