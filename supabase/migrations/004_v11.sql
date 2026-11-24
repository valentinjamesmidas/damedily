-- DámeDíly v1.1. Prodává jen DámeDíly s.r.o.
-- EKOKLADNO, provize a internal_project_tag mizí. Původ skladové položky
-- nese jen sloupec source: vlastni_sklad / cizi_zdroj / dropship.
-- Minimum 2 000 Kč je součet zboží včetně DPH, bez dopravy a služeb (R23-A).
--
-- Vrácení této migrace, ručně a jen když se ještě nemá nechat v produkci:
-- 1. Zastavit zápisy.
-- 2. Obnovit typ public.project_tag a sloupce internal_project_tag
--    na inventory_items a order_items.
-- 3. Doplnit je z archive.inventory_project_tag a archive.order_item_project_tag.
-- 4. Sundat triggery orders_goods_deferred, order_items_goods_minimum_*,
--    orders_enforce_write, profiles_enforce_email, auth_users_enforce_email
--    a funkci public.insert_order_with_lines. Sloupce line_kind a source
--    sundat jen když se vrací i schéma před v1.1.
-- 5. Vrátit CHECK orders_total_amount_czk_min, pokud se má znovu hlídat
--    celková částka místo součtu zboží.
-- 6. Schéma archive nemazat, dokud počet obnovených řádků nesedí.

-- ---------------------------------------------------------------------------
-- Sklad: jeden vlastník, původ jen ve source.
-- ---------------------------------------------------------------------------

alter table public.inventory_items
  add column if not exists source text;

update public.inventory_items
set source = 'vlastni_sklad'
where source is null;

alter table public.inventory_items
  alter column source set default 'vlastni_sklad',
  alter column source set not null;

do $$
begin
  alter table public.inventory_items
    add constraint inventory_items_source_check
    check (source in ('vlastni_sklad', 'cizi_zdroj', 'dropship'));
exception
  when duplicate_object then null;
end $$;

comment on column public.inventory_items.source is
  'Původ kusů: vlastni_sklad, cizi_zdroj nebo dropship. Jediný prodejce je DámeDíly s.r.o.';

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

create table if not exists archive.inventory_project_tag (
  item_id uuid not null,
  internal_project_tag text not null,
  archived_at timestamptz not null default now()
);

create table if not exists archive.order_item_project_tag (
  item_id uuid not null,
  internal_project_tag text not null,
  archived_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inventory_items'
      and column_name = 'internal_project_tag'
  ) then
    insert into archive.inventory_project_tag (item_id, internal_project_tag)
    select id, internal_project_tag::text
    from public.inventory_items;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_items'
      and column_name = 'internal_project_tag'
  ) then
    insert into archive.order_item_project_tag (item_id, internal_project_tag)
    select id, internal_project_tag::text
    from public.order_items;
  end if;
end $$;

drop index if exists public.inventory_items_project_tag_idx;
drop index if exists public.order_items_project_tag_idx;

alter table public.inventory_items
  drop column if exists internal_project_tag;

alter table public.order_items
  drop column if exists internal_project_tag;

drop type if exists public.project_tag;

comment on view public.public_inventory is
  'Veřejný sklad bez nákupní ceny, původu skladu a kompaktního OEM. security_invoker zůstává vypnuté.';

comment on view public.customer_order_items is
  'Položky objednávky přihlášeného zákazníka bez zdroje, nákupní ceny a reference dodavatele. security_invoker zůstává vypnuté.';

-- security_invoker = true by rozbilo veřejné čtení. View běží jako vlastník,
-- protože anon na inventory_items SELECT nemá a zákazník přes RLS nedostane
-- žádný řádek inventory_items ani order_items. Zapnutí invokera by chtělo
-- grant a politiku na podkladové tabulce, tedy přímé čtení, které schéma zakazuje.
-- Obě veřejná view proto zůstávají security_invoker = false a security_barrier = true.

-- ---------------------------------------------------------------------------
-- Objednávka: vkládá jen admin, platbu zákazník nenastaví.
-- Minimum je součet zboží vč. DPH, ne total_amount_czk.
-- ---------------------------------------------------------------------------

alter table public.orders
  drop constraint if exists orders_total_amount_czk_min;

alter table public.order_items
  add column if not exists line_kind text not null default 'zbozi';

do $$
begin
  alter table public.order_items
    add constraint order_items_line_kind_check
    check (line_kind in ('zbozi', 'doprava', 'sluzba'));
exception
  when duplicate_object then null;
end $$;

comment on column public.order_items.line_kind is
  'zbozi vstupuje do minima 2 000 Kč včetně DPH. doprava a sluzba ne (R23-A).';

comment on column public.order_items.selling_price_czk is
  'Jednotková cena včetně DPH.';

create or replace function private.assert_order_goods_minimum(target uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  goods numeric;
  items integer;
begin
  if not exists (select 1 from public.orders where id = target) then
    return;
  end if;

  select
    count(*) filter (where oi.line_kind = 'zbozi'),
    coalesce(sum(oi.selling_price_czk * oi.quantity) filter (where oi.line_kind = 'zbozi'), 0)
  into items, goods
  from public.order_items as oi
  where oi.order_id = target;

  if goods < 2000 then
    raise exception 'Součet zboží včetně DPH musí být alespoň 2 000 Kč.'
      using errcode = '23514';
  end if;

  update public.orders as o
  set total_amount_czk = (
    select coalesce(sum(oi.selling_price_czk * oi.quantity), 0)
    from public.order_items as oi
    where oi.order_id = target
  )
  where o.id = target
    and o.total_amount_czk is distinct from (
      select coalesce(sum(oi.selling_price_czk * oi.quantity), 0)
      from public.order_items as oi
      where oi.order_id = target
    );
end;
$$;

create or replace function private.enforce_order_goods_from_new()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target uuid;
begin
  for target in select distinct order_id from new_rows loop
    perform private.assert_order_goods_minimum(target);
  end loop;
  return null;
end;
$$;

create or replace function private.enforce_order_goods_from_old()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target uuid;
begin
  for target in select distinct order_id from old_rows loop
    perform private.assert_order_goods_minimum(target);
  end loop;
  return null;
end;
$$;

create or replace function private.enforce_order_goods_from_both()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target uuid;
begin
  for target in
    select distinct changed.order_id
    from (
      select order_id from new_rows
      union
      select order_id from old_rows
    ) as changed
  loop
    perform private.assert_order_goods_minimum(target);
  end loop;
  return null;
end;
$$;

drop trigger if exists order_items_goods_minimum_insert on public.order_items;
create trigger order_items_goods_minimum_insert
  after insert on public.order_items
  referencing new table as new_rows
  for each statement
  execute function private.enforce_order_goods_from_new();

drop trigger if exists order_items_goods_minimum_delete on public.order_items;
create trigger order_items_goods_minimum_delete
  after delete on public.order_items
  referencing old table as old_rows
  for each statement
  execute function private.enforce_order_goods_from_old();

drop trigger if exists order_items_goods_minimum_update on public.order_items;
create trigger order_items_goods_minimum_update
  after update on public.order_items
  referencing new table as new_rows old table as old_rows
  for each statement
  execute function private.enforce_order_goods_from_both();

revoke all on function private.assert_order_goods_minimum(uuid) from public;
revoke all on function private.enforce_order_goods_from_new() from public;
revoke all on function private.enforce_order_goods_from_old() from public;
revoke all on function private.enforce_order_goods_from_both() from public;
-- Samotný trigger EXECUTE pro authenticated nepotřebuje. Potřebuje ho jen
-- assert_order_goods_minimum, protože ho trigger volá jako aktuálního uživatele.
grant execute on function private.assert_order_goods_minimum(uuid) to authenticated, service_role;

create or replace function private.enforce_order_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin')
     or (select private.is_admin()) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Objednávku smí založit jen administrátor.'
      using errcode = '42501';
  end if;

  if new.payment_status is distinct from old.payment_status then
    raise exception 'Stav platby smí změnit jen administrátor.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists orders_enforce_write on public.orders;
create trigger orders_enforce_write
  before insert or update on public.orders
  for each row
  execute function private.enforce_order_write();

revoke all on function private.enforce_order_write() from public;

drop policy if exists orders_insert_own_or_admin on public.orders;
drop policy if exists orders_insert_admin on public.orders;
create policy orders_insert_admin
  on public.orders
  for insert
  to authenticated
  with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Zákazník si v profilu nemění e-mail. Administrátor ano.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_profile_email()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' or new.email is not distinct from old.email then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin')
     or (select private.is_admin()) then
    return new;
  end if;

  raise exception 'Změna e-mailu je povolená jen administrátorovi.'
    using errcode = '42501';
end;
$$;

drop trigger if exists profiles_enforce_email on public.profiles;
create trigger profiles_enforce_email
  before update on public.profiles
  for each row
  execute function private.enforce_profile_email();

revoke all on function private.enforce_profile_email() from public;

-- Mazání objednávky kaskádou smaže řádky, zatímco hlavička už v tabulce není,
-- takže assert_order_goods_minimum kontrolu přeskočí. Žádný přepínač v session.
drop trigger if exists orders_mark_deleting on public.orders;
drop trigger if exists orders_unmark_deleting on public.orders;
drop function if exists private.mark_order_deleting();
drop function if exists private.unmark_order_deleting();

-- Prázdná objednávka ani objednávka pod minimem neprojde commitem.
create or replace function private.enforce_committed_order_goods()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.orders where id = new.id) then
    return null;
  end if;
  perform private.assert_order_goods_minimum(new.id);
  return null;
end;
$$;

drop trigger if exists orders_goods_deferred on public.orders;
create constraint trigger orders_goods_deferred
  after insert or update on public.orders
  deferrable initially deferred
  for each row
  execute function private.enforce_committed_order_goods();

revoke all on function private.enforce_committed_order_goods() from public;

-- GoTrue mění auth.users jako supabase_auth_admin, i když e-mail mění zákazník.
-- Tenhle role v allowlistu není, takže updateUser({ email }) spadne.
-- service_role, postgres a administrátor (is_admin) e-mail změnit smí.
-- V config.toml není přepínač, který by vypnul jen změnu e-mailu a nechal přihlášení.
create or replace function private.enforce_auth_user_email()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' or new.email is not distinct from old.email then
    return new;
  end if;

  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or (select private.is_admin()) then
    return new;
  end if;

  raise exception 'Změna přihlašovacího e-mailu je vypnutá.'
    using errcode = '42501';
end;
$$;

drop trigger if exists auth_users_enforce_email on auth.users;
create trigger auth_users_enforce_email
  before update of email on auth.users
  for each row
  execute function private.enforce_auth_user_email();

revoke all on function private.enforce_auth_user_email() from public;
grant execute on function private.is_admin() to supabase_auth_admin;

-- PostgREST neumí vložit objednávku a řádky jako jeden zápis bez vloženého sloupce.
-- Tahle funkce je jeden požadavek, takže odložená kontrola minima vidí řádky.
create or replace function public.insert_order_with_lines(order_row jsonb, lines jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not (select private.is_admin()) then
    raise exception 'Objednávku smí založit jen administrátor.'
      using errcode = '42501';
  end if;

  insert into public.orders (id, order_number, user_id, total_amount_czk)
  values (
    coalesce((order_row ->> 'id')::uuid, gen_random_uuid()),
    order_row ->> 'order_number',
    (order_row ->> 'user_id')::uuid,
    coalesce((order_row ->> 'total_amount_czk')::numeric, 0)
  )
  returning id into new_id;

  insert into public.order_items (
    id,
    order_id,
    item_title_cs,
    oem_number,
    source_platform,
    supplier_order_ref,
    cost_price_czk,
    selling_price_czk,
    quantity,
    line_kind
  )
  select
    coalesce((line ->> 'id')::uuid, gen_random_uuid()),
    new_id,
    line ->> 'item_title_cs',
    line ->> 'oem_number',
    (line ->> 'source_platform')::public.source_platform,
    nullif(line ->> 'supplier_order_ref', ''),
    (line ->> 'cost_price_czk')::numeric,
    (line ->> 'selling_price_czk')::numeric,
    (line ->> 'quantity')::integer,
    coalesce(nullif(line ->> 'line_kind', ''), 'zbozi')
  from jsonb_array_elements(coalesce(lines, '[]'::jsonb)) as line;

  return new_id;
end;
$$;

revoke all on function public.insert_order_with_lines(jsonb, jsonb) from public, anon;
grant execute on function public.insert_order_with_lines(jsonb, jsonb) to service_role, authenticated;
