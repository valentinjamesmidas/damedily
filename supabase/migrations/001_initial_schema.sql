-- DámeDíly.cz, krok 1.
-- Schéma podle sekce 8 masterpromptu. Právní dodatek má přednost:
-- internal_project_tag, source_platform, cost_price_czk a supplier_order_ref
-- se nesmí vrátit anonymovi ani zákazníkovi.
--
-- Admin i zákazník sdílejí databázovou roli authenticated. Rozdíl je v profiles.role.
-- Anon nemá na základní tabulky GRANT (přímý SELECT skončí 42501).
-- Zákazník GRANT má, ale RLS mu nevrátí žádný řádek tabulky se citlivými sloupci.
-- Veřejný sklad čte jen view public_inventory. View je schválně security_invoker = false:
-- anon a customer na podkladovou tabulku SELECT nemají (resp. RLS nic nevrátí) a view
-- čte tabulku jako vlastník, ale vypisuje jen bezpečné sloupce.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Enumy
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('customer', 'admin');

create type public.project_tag as enum ('ekokladno', 'damedily');

create type public.placement_type as enum (
  'action_offer',
  'permanent_offer',
  'van_tires'
);

create type public.search_query_type as enum ('chat', 'catalog', 'photo');

create type public.search_status as enum (
  'first_found',
  'searching_alternatives',
  'completed'
);

create type public.payment_status as enum (
  'authorized_hold',
  'captured',
  'cancelled'
);

create type public.order_status as enum (
  'ordered_to_facility',
  'in_manual_inspection',
  'shipped_with_warranty',
  'delivered'
);

create type public.source_platform as enum (
  'internal_stock',
  'inter_cars',
  'auto_partner',
  'autodoc',
  'ovoko',
  'b_parts'
);

-- ---------------------------------------------------------------------------
-- Pomocné funkce v neexponovaném schématu.
-- Autorizace nesmí číst user_metadata. Role žije v public.profiles.
-- ---------------------------------------------------------------------------

create or replace function private.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'::public.user_role
  );
end;
$$;

revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated, service_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    nullif(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    'customer'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;
grant execute on function private.handle_new_user() to supabase_auth_admin;

create or replace function private.enforce_profile_role()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.role = 'customer'::public.user_role then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.role is not distinct from old.role then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin')
     or (select private.is_admin()) then
    return new;
  end if;

  raise exception 'Změna role je povolená jen administrátorovi.'
    using errcode = '42501';
end;
$$;

revoke all on function private.enforce_profile_role() from public;
grant execute on function private.enforce_profile_role() to authenticated, service_role, supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Tabulky
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  phone text,
  company_ico text,
  company_dic text,
  role public.user_role not null default 'customer'
);

create unique index profiles_email_unique
  on public.profiles (email)
  where email is not null and email <> '';

create trigger profiles_enforce_role
  before insert or update on public.profiles
  for each row
  execute function private.enforce_profile_role();

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  title_cs text not null,
  oem_number text not null,
  part_category text not null,
  vehicle_compatibility jsonb not null default '[]'::jsonb,
  tire_specs jsonb,
  cost_price_czk numeric(12, 2) not null,
  selling_price_czk numeric(12, 2) not null,
  stock_quantity integer not null default 0,
  placement_type public.placement_type not null,
  internal_project_tag public.project_tag not null,
  images text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint inventory_items_cost_nonnegative check (cost_price_czk >= 0),
  constraint inventory_items_selling_nonnegative check (selling_price_czk >= 0),
  constraint inventory_items_stock_nonnegative check (stock_quantity >= 0),
  constraint inventory_items_tire_specs_shape check (
    tire_specs is null
    or (
      jsonb_typeof(tire_specs) = 'object'
      and tire_specs ? 'width'
      and tire_specs ? 'profile'
      and tire_specs ? 'diameter'
      and tire_specs ? 'load_index'
      and tire_specs ? 'season'
    )
  )
);

comment on column public.inventory_items.cost_price_czk is
  'Nákupní cena. Anon ani zákazník ji nesmí dostat; čte ji jen admin a service_role.';

comment on column public.inventory_items.internal_project_tag is
  'Interní tag projektu. Na klientském frontendu ani ve veřejném čtení skladu nesmí být.';

create index inventory_items_placement_idx
  on public.inventory_items (placement_type);

create index inventory_items_oem_idx
  on public.inventory_items (oem_number);

create index inventory_items_project_tag_idx
  on public.inventory_items (internal_project_tag);

create table public.search_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  query_type public.search_query_type not null,
  raw_query text not null,
  resolved_oem text,
  status public.search_status not null,
  results jsonb not null default '[]'::jsonb
);

create index search_sessions_user_id_idx
  on public.search_sessions (user_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references public.profiles (id) on delete restrict,
  total_amount_czk numeric(12, 2) not null,
  payment_intent_id text,
  payment_status public.payment_status not null default 'authorized_hold',
  order_status public.order_status not null default 'ordered_to_facility',
  inspection_photos text[] not null default '{}',
  inspector_notes text,
  created_at timestamptz not null default now(),
  constraint orders_total_amount_czk_min check (total_amount_czk >= 2000)
);

create index orders_user_id_idx
  on public.orders (user_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  item_title_cs text not null,
  oem_number text not null,
  source_platform public.source_platform not null,
  supplier_order_ref text,
  internal_project_tag public.project_tag not null,
  cost_price_czk numeric(12, 2) not null,
  selling_price_czk numeric(12, 2) not null,
  quantity integer not null,
  constraint order_items_cost_nonnegative check (cost_price_czk >= 0),
  constraint order_items_selling_nonnegative check (selling_price_czk >= 0),
  constraint order_items_quantity_positive check (quantity > 0)
);

comment on column public.order_items.source_platform is
  'Skutečný zdroj nákupu. Zákazník ho z API nedostane.';

comment on column public.order_items.supplier_order_ref is
  'Reference objednávky u dodavatele. Zákazník ji z API nedostane.';

comment on column public.order_items.cost_price_czk is
  'Nákupní cena položky. Zákazník ji z API nedostane.';

comment on column public.order_items.internal_project_tag is
  'Interní tag projektu. Zákazník ho z API nedostane.';

create index order_items_order_id_idx
  on public.order_items (order_id);

create index order_items_project_tag_idx
  on public.order_items (internal_project_tag);

-- ---------------------------------------------------------------------------
-- Bezpečné projekce
-- ---------------------------------------------------------------------------

create view public.public_inventory
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
  created_at
from public.inventory_items;

comment on view public.public_inventory is
  'Veřejný sklad bez cost_price_czk a internal_project_tag. security_invoker je vypnuté schválně.';

create view public.customer_order_items
with (security_invoker = false, security_barrier = true) as
select
  oi.id,
  oi.order_id,
  oi.item_title_cs,
  oi.oem_number,
  oi.selling_price_czk,
  oi.quantity
from public.order_items as oi
inner join public.orders as o on o.id = oi.order_id
where o.user_id = (select auth.uid());

comment on view public.customer_order_items is
  'Položky objednávky přihlášeného zákazníka bez zdroje, nákupní ceny, tagu a reference dodavatele.';

-- ---------------------------------------------------------------------------
-- Granty. Nejdřív všechno sebereme, pak vrátíme jen to, co má být v API.
-- ---------------------------------------------------------------------------

revoke all on table public.profiles from public, anon, authenticated, service_role;
revoke all on table public.inventory_items from public, anon, authenticated, service_role;
revoke all on table public.search_sessions from public, anon, authenticated, service_role;
revoke all on table public.orders from public, anon, authenticated, service_role;
revoke all on table public.order_items from public, anon, authenticated, service_role;
revoke all on table public.public_inventory from public, anon, authenticated, service_role;
revoke all on table public.customer_order_items from public, anon, authenticated, service_role;

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

grant select, insert, update, delete on table public.inventory_items to authenticated, service_role;
grant select, insert, update, delete on table public.search_sessions to authenticated, service_role;
grant select, insert, update, delete on table public.orders to authenticated, service_role;
grant select, insert, update, delete on table public.order_items to authenticated, service_role;

grant select on table public.public_inventory to anon, authenticated, service_role;
grant select on table public.customer_order_items to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.inventory_items enable row level security;
alter table public.search_sessions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

alter table public.profiles force row level security;
alter table public.inventory_items force row level security;
alter table public.search_sessions force row level security;
alter table public.orders force row level security;
alter table public.order_items force row level security;

create policy profiles_select_own_or_admin
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_admin())
  );

create policy profiles_update_own_or_admin
  on public.profiles
  for update
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_admin())
  )
  with check (
    id = (select auth.uid())
    or (select private.is_admin())
  );

create policy inventory_items_admin_all
  on public.inventory_items
  for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy search_sessions_select_own_or_admin
  on public.search_sessions
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
  );

create policy search_sessions_insert_own_or_admin
  on public.search_sessions
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    or (select private.is_admin())
  );

create policy search_sessions_update_own_or_admin
  on public.search_sessions
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
  )
  with check (
    user_id = (select auth.uid())
    or (select private.is_admin())
  );

create policy search_sessions_delete_own_or_admin
  on public.search_sessions
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
  );

create policy orders_select_own_or_admin
  on public.orders
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_admin())
  );

create policy orders_insert_own_or_admin
  on public.orders
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    or (select private.is_admin())
  );

create policy orders_update_admin
  on public.orders
  for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy orders_delete_admin
  on public.orders
  for delete
  to authenticated
  using ((select private.is_admin()));

create policy order_items_admin_all
  on public.order_items
  for all
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
