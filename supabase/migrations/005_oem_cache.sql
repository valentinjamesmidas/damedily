-- Cache odpovědí zdrojů podle OEM.
-- Payload smí obsahovat nákupní cenu. Anon ani zákazník tabulku nečte a nezapisuje.
-- Čtení i zápis má jen service_role, tedy server s SUPABASE_SERVICE_ROLE_KEY.

create table public.oem_cache (
  oem text not null,
  source text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  ttl interval not null,
  constraint oem_cache_pkey primary key (oem, source),
  constraint oem_cache_oem_normalized check (oem ~ '^[A-Z0-9]{1,80}$'),
  constraint oem_cache_source_check check (source ~ '^[a-z][a-z0-9_]{0,40}$'),
  constraint oem_cache_ttl_positive check (ttl > interval '0')
);

comment on table public.oem_cache is
  'Serverová cache hledání podle OEM. Zákazník ani anon k ní nemají přístup, protože payload nese cenu zdroje.';

comment on column public.oem_cache.oem is
  'Normalizované OEM: jen A–Z a číslice, nejvýš 80 znaků.';

comment on column public.oem_cache.source is
  'Id zdroje, malá písmena, číslice a podtržítko.';

comment on column public.oem_cache.payload is
  'Odpověď zdroje včetně nákupní ceny. Do veřejné nabídky se odsud nesmí přepsat.';

comment on column public.oem_cache.fetched_at is
  'Čas uložení odpovědi.';

comment on column public.oem_cache.ttl is
  'Jak dlouho je řádek platný. Vyprší ve fetched_at + ttl.';

revoke all on table public.oem_cache from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.oem_cache to service_role;

alter table public.oem_cache enable row level security;
alter table public.oem_cache force row level security;

create policy oem_cache_service_all
  on public.oem_cache
  for all
  to service_role
  using (true)
  with check (true);
