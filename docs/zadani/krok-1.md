# DámeDíly.cz – zadání pro cloud agenta, krok 1 (kostra + schéma)
Repo: https://github.com/valentinjamesmidas/damedily (prázdné, soukromé). Pracuj ve větvi `feat/krok-1-kostra`, otevři pull request do main, nikdy necommituj přímo do main. Závazné zadání je v přiloženém MASTERPROMPT.md (dodatek Právní mantinely má přednost).

## Cíl
1. Kostra Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui, Lucide, Framer Motion. Tailwind tokeny: primary #1E293B, accent #FF5A1F, background #F8FAFC. Čeština jako jazyk UI. Základní layout s hlavičkou a 4 pilíři důvěry (zatím statické), placeholder stránky `/`, `/ucet`, `/admin`.
2. Supabase: `supabase/migrations/001_initial_schema.sql` přesně podle sekce 8 masterpromptu (profiles, inventory_items, search_sessions, orders s CHECK total >= 2000, order_items), ENUMy, RLS na všech tabulkách, role customer/admin.
3. Zabezpečení: `source_platform`, `cost_price_czk` a `supplier_order_ref` se nikdy nevrací anonymům ani zákazníkům. Veřejné čtení skladu jen přes view (např. `public_inventory`) bez těchto sloupců; přímý SELECT na tabulky pro anon/customer zakázat. Admin vidí vše. Od v1.1 sloupec `internal_project_tag` neexistuje; původ skladu je `source` a ve veřejném view také není.
4. `lib/pricing.ts`: prodejní cena podle pásem nákupu (do 1 000 Kč marže 60 %, 1 001–5 000 a 5 001–15 000 50 %, 15 001–40 000 30 %, nad 40 000 25 %), zaokrouhlení nahoru na desetikoruny a monotonie na hraně pásma. Minimum `MIN_ORDER_CZK = 2000` se počítá ze zboží, ne z dopravy a služeb. Unit testy (Vitest).
5. Testy RLS a API (spustitelné lokálně přes `supabase start` + pgTAP nebo skript proti lokální DB), které dokazují bod 3, včetně testu, že CHECK na 2000 Kč funguje.
6. CI v GitHub Actions: typecheck, lint, unit testy, a RLS testy proti lokálnímu Supabase.
7. `.env.example` bez hodnot, žádné tajné klíče v repu. README česky: jak spustit lokálně.

## Mimo rozsah
xAI integrace, vyhledávání, platby, dodavatelé – to jsou další kroky.

## Hotovo, když
`tsc --noEmit`, lint, unit i RLS testy procházejí lokálně i v CI a PR popisuje, co a jak je ověřeno. Netvrď nic, co neprošlo.
