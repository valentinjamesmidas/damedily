export const INSPECTION_SEAL = "Ručně kontrolováno – Záruka DámeDíly.cz";

export const ALTERNATIVE_NOTICE = "Právě jsme pro vás ověřili další alternativu…";

export const TAG_REQUIRED_MESSAGE = "Vyberte projekt EKOKLADNO nebo DAMEDILY.";

export const PART_CATEGORIES = [
  "Brzdy",
  "Karoserie",
  "Motor",
  "Elektro",
  "Podvozek",
  "Filtry",
  "Osvětlení",
  "Chlazení",
  "Výfuk",
  "Spojka a převodovka",
  "Pneu",
] as const;

export function formatCzk(amount: number): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "CZK",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
