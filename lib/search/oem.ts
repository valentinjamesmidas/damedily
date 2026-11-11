/** Porovnání OEM bez mezer, pomlček a teček. Neodhaduje význam čísla. */
export function compactOem(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function oemEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = compactOem(left);
  const b = compactOem(right);
  return a.length > 0 && a === b;
}
