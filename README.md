# DámeDíly.cz

Kostra e-shopu (krok 1): Next.js, schéma Supabase a testy, které hlídají minimální objednávku 2&nbsp;000&nbsp;Kč a to, že se nákupní cena, interní tag, zdroj a reference dodavatele nevracejí anonymovi ani zákazníkovi.

Zadání produktu je v [docs/MASTERPROMPT.md](docs/MASTERPROMPT.md). Dodatek Právní mantinely má přednost. Rozsah tohoto kroku je v [docs/zadani/krok-1.md](docs/zadani/krok-1.md).

Vyhledávání, platby, xAI a napojení dodavatelů tu záměrně nejsou.

## Požadavky

- Node.js 22
- Docker
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) 3.1.0 (stejná verze jako v CI)

## Lokální spuštění

```bash
npm install
cp .env.example .env.local
```

Do `.env.local` doplňte hodnoty z `supabase status -o env` až po `supabase start`. Soubor s hodnotami se necommituje. V repozitáři zůstává jen `.env.example` bez hodnot.

```bash
supabase start
npm run dev
```

Aplikace běží na [http://127.0.0.1:3000](http://127.0.0.1:3000). Stránky `/`, `/ucet` a `/admin` jsou záměrně jen kostra.

Lokální `supabase start` používá demonstrační JWT z `supabase/config.toml`. Není to produkční tajemství a do hostovaného projektu nepatří.

## Testy

```bash
npm run typecheck
npm run lint
npm test
supabase test db
supabase status -o env > .supabase.env
set -a && source .supabase.env && set +a
npm run test:rls-api
```

- `npm test` jsou unit testy ceny a minima (Vitest), databázi nepotřebují.
- `supabase test db` pouští pgTAP v `supabase/tests` proti lokálnímu Postgresu.
- `npm run test:rls-api` volá Auth a PostgREST. Bez běžícího Supabase spadne, neskipuje se.

V GitHub Actions běží typecheck, lint a unit testy v jednom jobu. Druhý job spustí lokální Supabase, pgTAP i API testy.

## Přístup k datům

| Kdo | Sklad | Položky objednávky |
| --- | --- | --- |
| Anonym | jen view `public_inventory` | nic |
| Zákazník | jen view `public_inventory` | jen view `customer_order_items` svých objednávek |
| Admin | tabulka `inventory_items` včetně nákupní ceny a tagu | tabulka `order_items` včetně zdroje, reference, nákupní ceny a tagu |

Anon na základní tabulky nemá `GRANT`. Zákazník a admin sdílejí roli `authenticated`, takže zákazníka od tabulky odděluje RLS: přímý `SELECT` nevrátí žádný řádek. První admin se nastaví ručně v SQL (`update profiles set role = 'admin'`), v repozitáři žádné heslo není.
