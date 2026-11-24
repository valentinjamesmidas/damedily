-- Cache odpovědí zdrojů podle OEM a trvalý stav blokace zdroje.
-- Payload smí obsahovat nákupní cenu. Anon ani zákazník tabulky nečtou a nezapisují.
-- Čtení i zápis má jen service_role, tedy server s SUPABASE_SERVICE_ROLE_KEY.

create table if not exists public.oem_cache (
  oem text not null,
  source text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  ttl interval not null,
  in_flight_until timestamptz,
  constraint oem_cache_pkey primary key (oem, source),
  constraint oem_cache_oem_normalized check (oem ~ '^[A-Z0-9]{1,80}$'),
  constraint oem_cache_source_check check (source ~ '^[a-z][a-z0-9_]{0,40}$'),
  constraint oem_cache_ttl_positive check (ttl > interval '0'),
  constraint oem_cache_payload_size check (octet_length(payload::text) <= 65536)
);

comment on table public.oem_cache is
  'Serverová cache hledání podle OEM. Zákazník ani anon k ní nemají přístup, protože payload nese cenu zdroje.';

comment on column public.oem_cache.oem is
  'Normalizované OEM: jen A–Z a číslice, nejvýš 80 znaků. Lomítko se před zápisem bere jako pomlčka.';

comment on column public.oem_cache.source is
  'Id zdroje, malá písmena, číslice a podtržítko.';

comment on column public.oem_cache.payload is
  'Úspěšná odpověď zdroje včetně nákupní ceny. Chyba se sem nezapisuje.';

comment on column public.oem_cache.fetched_at is
  'Čas uložení úspěšné odpovědi.';

comment on column public.oem_cache.ttl is
  'Jak dlouho je řádek platný. Vyprší ve fetched_at + ttl.';

comment on column public.oem_cache.in_flight_until is
  'Lease běžícího stažení. Druhý worker stejný klíč do té doby nevolá.';

create index if not exists oem_cache_fetched_at_idx
  on public.oem_cache (fetched_at);

create table if not exists public.source_health (
  source text primary key,
  block_count integer not null default 0,
  window_start timestamptz not null default now(),
  tripped_at timestamptz,
  reset_at timestamptz,
  constraint source_health_source_check check (source ~ '^[a-z][a-z0-9_]{0,40}$'),
  constraint source_health_count_nonnegative check (block_count >= 0)
);

comment on table public.source_health is
  'Počet 403 a captcha v okně. Po prahu tripped_at drží vypnutí do ručního resetu.';

comment on column public.source_health.reset_at is
  'Ruční reset. Po něm se okno i počet počítají znovu.';

revoke all on table public.oem_cache from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.oem_cache to service_role;

revoke all on table public.source_health from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.source_health to service_role;

alter table public.oem_cache enable row level security;
alter table public.oem_cache force row level security;
alter table public.source_health enable row level security;
alter table public.source_health force row level security;

drop policy if exists oem_cache_service_all on public.oem_cache;
create policy oem_cache_service_all
  on public.oem_cache
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists source_health_service_all on public.source_health;
create policy source_health_service_all
  on public.source_health
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.purge_expired_oem_cache()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.oem_cache
  where fetched_at + ttl <= now()
    and (in_flight_until is null or in_flight_until <= now());
  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.purge_expired_oem_cache() is
  'Smaže prošlé řádky cache, které právě nikdo nestahuje.';

create or replace function public.try_lease_oem_cache(p_oem text, p_source text, p_until timestamptz)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated integer;
begin
  if p_oem !~ '^[A-Z0-9]{1,80}$' or p_source !~ '^[a-z][a-z0-9_]{0,40}$' or p_until <= now() then
    return false;
  end if;

  update public.oem_cache
  set in_flight_until = p_until
  where oem = p_oem
    and source = p_source
    and (in_flight_until is null or in_flight_until <= now())
    and fetched_at + ttl <= now();
  get diagnostics updated = row_count;
  if updated = 1 then
    return true;
  end if;

  begin
    insert into public.oem_cache (oem, source, payload, fetched_at, ttl, in_flight_until)
    values (p_oem, p_source, '[]'::jsonb, now() - interval '1 second', interval '1 millisecond', p_until);
    return true;
  exception
    when unique_violation then
      return false;
  end;
end;
$$;

comment on function public.try_lease_oem_cache(text, text, timestamptz) is
  'Vezme lease stažení, když řádek není čerstvý a lease zrovna nikdo nedrží.';

create or replace function public.record_source_block(
  p_source text,
  p_window interval,
  p_threshold integer
)
returns table (block_count integer, tripped boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  row public.source_health%rowtype;
begin
  if p_window <= interval '0' or p_threshold < 1 then
    raise exception 'Okno i práh blokace musí být kladné.'
      using errcode = '22023';
  end if;

  insert into public.source_health (source, block_count, window_start)
  values (p_source, 0, now())
  on conflict (source) do nothing;

  select * into row
  from public.source_health
  where source = p_source
  for update;

  if row.tripped_at is not null and (row.reset_at is null or row.reset_at < row.tripped_at) then
    block_count := row.block_count;
    tripped := true;
    return next;
    return;
  end if;

  if now() - row.window_start >= p_window then
    row.block_count := 0;
    row.window_start := now();
    row.tripped_at := null;
  end if;

  row.block_count := row.block_count + 1;
  if row.block_count >= p_threshold then
    row.tripped_at := now();
  end if;

  update public.source_health
  set
    block_count = row.block_count,
    window_start = row.window_start,
    tripped_at = row.tripped_at
  where source = p_source;

  block_count := row.block_count;
  tripped := row.tripped_at is not null;
  return next;
end;
$$;

comment on function public.record_source_block(text, interval, integer) is
  'Přičte 403 nebo captcha. Po vypršení okna začne počet znovu. Vypnutí drží do resetu.';

create or replace function public.reset_source_health(p_source text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.source_health (source, block_count, window_start, tripped_at, reset_at)
  values (p_source, 0, now(), null, now())
  on conflict (source) do update
  set
    block_count = 0,
    window_start = now(),
    tripped_at = null,
    reset_at = now();
end;
$$;

comment on function public.reset_source_health(text) is
  'Ruční reset vypnutí zdroje.';

create or replace function public.release_lease_oem_cache(p_oem text, p_source text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.oem_cache
  set in_flight_until = null
  where oem = p_oem and source = p_source;
$$;

comment on function public.release_lease_oem_cache(text, text) is
  'Po chybě zdroje zámek pustí, aby další úloha mohla zdroj zkusit znovu.';

revoke all on function public.purge_expired_oem_cache() from public, anon, authenticated;
revoke all on function public.try_lease_oem_cache(text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.release_lease_oem_cache(text, text) from public, anon, authenticated;
revoke all on function public.record_source_block(text, interval, integer) from public, anon, authenticated;
revoke all on function public.reset_source_health(text) from public, anon, authenticated;

grant execute on function public.purge_expired_oem_cache() to service_role;
grant execute on function public.try_lease_oem_cache(text, text, timestamptz) to service_role;
grant execute on function public.release_lease_oem_cache(text, text) to service_role;
grant execute on function public.record_source_block(text, interval, integer) to service_role;
grant execute on function public.reset_source_health(text) to service_role;
