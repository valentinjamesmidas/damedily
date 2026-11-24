/**
 * Normalizace OEM pro hledání.
 * Velká písmena, pryč mezery, tečky, lomítka a pomlčky. Jiné znaky zůstávají,
 * ať se význam čísla nedomýšlí. Lomítko se bere stejně jako pomlčka.
 */
const OEM_STRIPPED = /[\s\u00A0./\u2010\u2011\u2012\u2013\u2014\u2212-]/g;

export function normalizeOem(value: string): string {
  return value.toUpperCase().replace(OEM_STRIPPED, "");
}

/**
 * Klíč do `oem_cache`. Po normalizaci jen A–Z a číslice, nejvýš 80 znaků.
 */
export function isCacheableOem(value: string): boolean {
  return /^[A-Z0-9]{1,80}$/.test(value);
}

/** Původní tvar a kompaktní tvar. Zdroj dostane oba, když se liší. */
export function oemLookupPhrases(value: string): string[] {
  const raw = value.trim();
  const compact = normalizeOem(value);
  const phrases: string[] = [];
  if (raw) phrases.push(raw);
  if (compact && compact !== raw) phrases.push(compact);
  return phrases;
}
