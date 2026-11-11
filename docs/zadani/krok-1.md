# DámeDíly.cz – zadání pro cloud agenta, krok 1 (kostra + schéma)
Repo: https://github.com/valentinjamesmidas/damedily (prázdné, soukromé). Pracuj ve větvi `feat/krok-1-kostra`, otevři pull request do main, nikdy necommituj přímo do main. Závazné zadání je v přiloženém MASTERPROMPT.md (dodatek Právní mantinely má přednost).

## Cíl
1. Kostra Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui, Lucide, Framer Motion. Tailwind tokeny: primary #1E293B, accent #FF5A1F, background #F8FAFC. Čeština jako jazyk UI. Základní layout s hlavičkou a 4 pilíři důvěry (zatím statické), placeholder stránky `/`, `/ucet`, `/admin`.
2. Supabase: `supabase/migrations/001_initial_schema.sql` přesně podle sekce 8 masterpromptu (profiles, inventory_items, search_sessions, orders s CHECK total >= 2000, order_items), ENUMy, RLS na všech tabulkách, role customer/admin.
3. Zabezpečení: `internal_project_tag`, `source_platform`, `cost_price_czk` a `supplier_order_ref` se nikdy nevrací anonymům ani zákazníkům. Veřejné čtení skladu jen přes view (např. `public_inventory`) bez těchto sloupců; přímý SELECT na tabulky pro anon/customer zakázat. Admin vidí vše.
4. `lib/pricing.ts`: `sellingPrice(cost) = Math.ceil(cost*1.5/10)*10`, konstanta MIN_ORDER_CZK = 2000 a funkce na chybějící částku. Unit testy (Vitest).
5. Testy RLS a API (spustitelné lokálně přes `supabase start` + pgTAP nebo skript proti lokální DB), které dokazují bod 3, včetně testu, že CHECK na 2000 Kč funguje.
6. CI v GitHub Actions: typecheck, lint, unit testy, a RLS testy proti lokálnímu Supabase.
7. `.env.example` bez hodnot, žádné tajné klíče v repu. README česky: jak spustit lokálně.

## Mimo rozsah
xAI integrace, vyhledávání, platby, dodavatelé – to jsou další kroky.

## Hotovo, když
`tsc --noEmit`, lint, unit i RLS testy procházejí lokálně i v CI a PR popisuje, co a jak je ověřeno. Netvrď nic, co neprošlo.
