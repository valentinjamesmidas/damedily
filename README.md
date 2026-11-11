# DámeDíly.cz

E-shop DámeDíly.cz. Krok 1 je kostra Next.js, schéma Supabase a testy, které hlídají minimální objednávku 2&nbsp;000&nbsp;Kč a to, že se nákupní cena, interní tag, zdroj a reference dodavatele nevracejí anonymovi ani zákazníkovi. Krok 2 přidává serverového klienta xAI, prompty Dílobota, maskování dodavatelů a interní endpoint `/api/dilobot`.

Zadání produktu je v [docs/MASTERPROMPT.md](docs/MASTERPROMPT.md). Dodatek Právní mantinely má přednost. Rozsah kostry je v [docs/zadani/krok-1.md](docs/zadani/krok-1.md).

Vyhledávání u dodavatelů, platby a veřejné UI Dílobota tu záměrně nejsou.

## Požadavky

- Node.js 22
- Docker
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) 3.1.0 (stejná verze jako v CI)

## Lokální spuštění

```bash
npm install
cp .env.example .env.local
```

Do `.env.local` doplňte hodnoty z `supabase status -o env` až po `supabase start`. `XAI_API_KEY` je jen na serveru a do gitu nepatří. Soubor s hodnotami se necommituje. V repozitáři zůstává jen `.env.example` bez klíče.

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

- `npm test` jsou unit testy (Vitest) s mockovaným xAI. Síť ani databázi nepotřebují.
- `npm run test:live` je volitelný smoke test proti `https://api.x.ai/v1/chat/completions`. Bez `XAI_API_KEY` se přeskočí a skončí úspěchem. V CI ho pouští samostatný job, jen když je v repozitáři secret `XAI_API_KEY`.
- `supabase test db` pouští pgTAP v `supabase/tests` proti lokálnímu Postgresu.
- `npm run test:rls-api` volá Auth a PostgREST. Bez běžícího Supabase spadne, neskipuje se.

V GitHub Actions běží typecheck, lint a unit testy v jednom jobu. Druhý job spustí lokální Supabase, pgTAP i API testy. Třetí job je živý test xAI a bez secretu se po kontrole klíče dál nespouští.

## xAI

Klient je v `lib/xai-grok.ts` a smí běžet jen na serveru. Volá `POST /v1/chat/completions` (OpenAI-kompatibilní chat completions). Dokumentace xAI novější schopnosti dává do Responses API; tenhle krok zůstává u chat completions, protože to vyžaduje zadání.

`XAI_TEXT_MODEL` a `XAI_VISION_MODEL` určují ID modelu. Když chybí, použije se `grok-4.7`, který bere text i obrázky. Model `grok-vision` v API není. Obrázek se posílá jako `image_url` s adresou `https` nebo jako `data:image/jpeg|png;base64,…` (nejvýš 20&nbsp;MiB). Strukturovaný výstup jde přes `response_format.type = json_schema` a výsledek se ještě ověří Zodem. Nástroje se předávají v poli `tools`.

`/api/dilobot` je `POST` se streamem `text/event-stream`. Tělo je `{ "messages": [{ "role": "user", "content": "…" }] }`. Systémový prompt nastavuje server, zákazník ho nepřepíše. Ve streamu je jen text odpovědi, ne interní uvažování modelu.

Veřejná nabídka z `lib/white-label.ts` má prodejní cenu z `sellingPrice`, stav, údaj použitý/nový a dodací lhůtu. U externího zdroje je to `4–5 pracovních dní` a označení skladu netvrdí, že díl už je v ČR. Vlastní sklad uvádí, že je na provozovně. V typu ani v JSON nejsou `cost_price`, `source_platform`, `internal_project_tag` ani AI skóre.

## Přístup k datům

| Kdo | Sklad | Položky objednávky |
| --- | --- | --- |
| Anonym | jen view `public_inventory` | nic |
| Zákazník | jen view `public_inventory` | jen view `customer_order_items` svých objednávek |
| Admin | tabulka `inventory_items` včetně nákupní ceny a tagu | tabulka `order_items` včetně zdroje, reference, nákupní ceny a tagu |

Anon na základní tabulky nemá `GRANT`. Zákazník a admin sdílejí roli `authenticated`, takže zákazníka od tabulky odděluje RLS: přímý `SELECT` nevrátí žádný řádek. První admin se nastaví ručně v SQL (`update profiles set role = 'admin'`), v repozitáři žádné heslo není.
