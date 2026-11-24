-- DámeDíly v1.1. Prodává jen DámeDíly s.r.o.
-- EKOKLADNO, provize a internal_project_tag mizí. Původ skladové položky
-- nese jen sloupec source: vlastni_sklad / cizi_zdroj / dropship.
-- Minimum 2 000 Kč je součet zboží včetně DPH, bez dopravy a služeb (R23-A).

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
  if current_setting('private.skip_goods_check', true) = 'on' then
    return;
  end if;

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
-- Trigger se spouští jako aktuální uživatel a Postgres u toho kontroluje EXECUTE.
-- Bez grantu authenticated by adminův zápis objednávky spadl na 42501.
-- Schéma private PostgREST nepublikuje, takže to není veřejné RPC.
grant execute on function private.assert_order_goods_minimum(uuid) to authenticated, service_role;
grant execute on function private.enforce_order_goods_from_new() to authenticated, service_role;
grant execute on function private.enforce_order_goods_from_old() to authenticated, service_role;
grant execute on function private.enforce_order_goods_from_both() to authenticated, service_role;

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
grant execute on function private.enforce_order_write() to authenticated, service_role;

drop policy if exists orders_insert_own_or_admin on public.orders;
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
grant execute on function private.enforce_profile_email() to authenticated, service_role;

-- Mazání objednávky smí smazat řádky, i když by součet zboží klesl pod minimum.
create or replace function private.mark_order_deleting()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform set_config('private.skip_goods_check', 'on', true);
  return old;
end;
$$;

create or replace function private.unmark_order_deleting()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform set_config('private.skip_goods_check', 'off', true);
  return old;
end;
$$;

drop trigger if exists orders_mark_deleting on public.orders;
create trigger orders_mark_deleting
  before delete on public.orders
  for each row
  execute function private.mark_order_deleting();

drop trigger if exists orders_unmark_deleting on public.orders;
create trigger orders_unmark_deleting
  after delete on public.orders
  for each row
  execute function private.unmark_order_deleting();

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

revoke all on function private.mark_order_deleting() from public;
revoke all on function private.unmark_order_deleting() from public;
revoke all on function private.enforce_committed_order_goods() from public;
grant execute on function private.mark_order_deleting() to authenticated, service_role;
grant execute on function private.unmark_order_deleting() to authenticated, service_role;
grant execute on function private.enforce_committed_order_goods() to authenticated, service_role;

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
grant execute on function private.enforce_auth_user_email() to supabase_auth_admin, authenticated, service_role;
grant execute on function private.is_admin() to supabase_auth_admin;
