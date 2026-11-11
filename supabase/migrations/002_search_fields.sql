-- Krok 3. Veřejný sklad umí říct, jestli je díl použitý nebo nový.
-- Kompaktní OEM je jen pro hledání a do veřejného view nepatří.
-- Anonymní hledání nemá uživatele, zákazník cizí ani anonymní relaci nevidí.

alter table public.inventory_items
  add column part_condition text,
  add column origin_kind text,
  add column oem_compact text generated always as (
    upper(regexp_replace(oem_number, '[^A-Za-z0-9]', '', 'g'))
  ) stored;

alter table public.inventory_items
  add constraint inventory_items_part_condition_check
  check (part_condition is null or part_condition in ('pouzity', 'novy'));

alter table public.inventory_items
  add constraint inventory_items_origin_kind_check
  check (origin_kind is null or origin_kind in ('oem', 'druhovyroba'));

comment on column public.inventory_items.part_condition is
  'pouzity nebo novy. Null se ve hledání nezveřejní, stav se nedomýšlí.';

comment on column public.inventory_items.origin_kind is
  'oem nebo druhovyroba. Null znamená, že to podklad neříká.';

comment on column public.inventory_items.oem_compact is
  'OEM bez mezer a znamének pro hledání. Veřejný sklad ho nevrací.';

create index inventory_items_oem_compact_idx
  on public.inventory_items (oem_compact);

create or replace view public.public_inventory
with (security_invoker = false, security_barrier = true) as
select
  id,
  title_cs,
  oem_number,
  part_category,
  vehicle_compatibility,
  tire_specs,
  selling_price_czk,
  stock_quantity,
  placement_type,
  images,
  created_at,
  part_condition,
  origin_kind
from public.inventory_items;

comment on view public.public_inventory is
  'Veřejný sklad bez nákupní ceny, tagu a kompaktního OEM. Stav a původ dílu vidět jsou.';

grant select on table public.public_inventory to anon, authenticated, service_role;

alter table public.search_sessions
  alter column user_id drop not null;

comment on column public.search_sessions.user_id is
  'Null je anonymní hledání. Zákazník ho nevidí, čte jen své řádky.';

comment on column public.search_sessions.results is
  'Jen veřejné nabídky. Bez zdroje, nákupní ceny, tagu a AI skóre.';
