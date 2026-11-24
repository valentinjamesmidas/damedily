begin;

create extension if not exists pgtap with schema extensions;

select plan(62);

select has_table('public', 'oem_cache', 'oem_cache existuje');
select has_column('public', 'oem_cache', 'oem', 'oem_cache má oem');
select has_column('public', 'oem_cache', 'source', 'oem_cache má source');
select has_column('public', 'oem_cache', 'payload', 'oem_cache má payload');
select has_column('public', 'oem_cache', 'fetched_at', 'oem_cache má fetched_at');
select has_column('public', 'oem_cache', 'ttl', 'oem_cache má ttl');
select col_type_is('public', 'oem_cache', 'payload', 'jsonb', 'payload je jsonb');
select col_type_is('public', 'oem_cache', 'fetched_at', 'timestamp with time zone', 'fetched_at je čas');
select col_type_is('public', 'oem_cache', 'ttl', 'interval', 'ttl je interval');
select col_is_pk('public', 'oem_cache', array['oem', 'source'], 'primární klíč je oem a source');
select ok(
  (
    select c.relrowsecurity and c.relforcerowsecurity
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'oem_cache'
  ),
  'oem_cache má vynucené RLS'
);

select ok(not has_table_privilege('anon', 'public.oem_cache', 'SELECT'), 'anon oem_cache nečte');
select ok(not has_table_privilege('anon', 'public.oem_cache', 'INSERT'), 'anon oem_cache nezapisuje');
select ok(not has_table_privilege('anon', 'public.oem_cache', 'UPDATE'), 'anon oem_cache nemění');
select ok(not has_table_privilege('anon', 'public.oem_cache', 'DELETE'), 'anon oem_cache nemaže');
select ok(not has_table_privilege('authenticated', 'public.oem_cache', 'SELECT'), 'zákazník oem_cache nečte');
select ok(not has_table_privilege('authenticated', 'public.oem_cache', 'INSERT'), 'zákazník oem_cache nezapisuje');
select ok(not has_table_privilege('authenticated', 'public.oem_cache', 'UPDATE'), 'zákazník oem_cache nemění');
select ok(not has_table_privilege('authenticated', 'public.oem_cache', 'DELETE'), 'zákazník oem_cache nemaže');
select ok(has_table_privilege('service_role', 'public.oem_cache', 'SELECT'), 'service_role oem_cache čte');
select ok(has_table_privilege('service_role', 'public.oem_cache', 'INSERT'), 'service_role oem_cache vkládá');
select ok(has_table_privilege('service_role', 'public.oem_cache', 'UPDATE'), 'service_role oem_cache mění');
select ok(has_table_privilege('service_role', 'public.oem_cache', 'DELETE'), 'service_role oem_cache maže');

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'oem_cache'
      and policyname = 'oem_cache_service_all'
      and cmd = 'ALL'
      and roles = array['service_role']::name[]
  ),
  'politika čtení a zápisu patří service_role'
);
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'oem_cache'
      and roles && array['anon', 'authenticated', 'public']::name[]
  ),
  'oem_cache nemá politiku pro anon ani authenticated'
);

set local role anon;
select throws_ok(
  'select payload from public.oem_cache',
  '42501',
  'permission denied for table oem_cache',
  'anon select na oem_cache nedostane'
);
reset role;

set local role authenticated;
select throws_ok(
  'select payload from public.oem_cache',
  '42501',
  'permission denied for table oem_cache',
  'zákazník select na oem_cache nedostane'
);
select throws_ok(
  $$insert into public.oem_cache (oem, source, payload, ttl)
    values ('1K0615301', 'allegro', '[]'::jsonb, interval '1 hour')$$,
  '42501',
  'permission denied for table oem_cache',
  'zákazník do oem_cache nezapíše'
);
select throws_ok(
  $$update public.oem_cache set payload = '[]'::jsonb where oem = '1K0615301'$$,
  '42501',
  'permission denied for table oem_cache',
  'zákazník oem_cache nemění'
);
reset role;

set local role service_role;
select lives_ok(
  $$insert into public.oem_cache (oem, source, payload, fetched_at, ttl)
    values (
      '1K0615301',
      'allegro',
      '{"price":123.45}'::jsonb,
      '2026-11-24T12:00:00Z',
      interval '1 hour'
    )$$,
  'service_role zapíše cache'
);
select is(
  (
    select payload = '{"price": 123.45}'::jsonb
    from public.oem_cache
    where oem = '1K0615301' and source = 'allegro'
  ),
  true,
  'service_role přečte payload cache'
);
select throws_ok(
  $$insert into public.oem_cache (oem, source, payload, ttl)
    values ('1K0-615', 'allegro', '[]'::jsonb, interval '1 hour')$$,
  '23514',
  'new row for relation "oem_cache" violates check constraint "oem_cache_oem_normalized"',
  'OEM s pomlčkou se neuloží'
);
select throws_ok(
  $$insert into public.oem_cache (oem, source, payload, ttl)
    values ('A/B', 'allegro', '[]'::jsonb, interval '1 hour')$$,
  '23514',
  'new row for relation "oem_cache" violates check constraint "oem_cache_oem_normalized"',
  'OEM mimo písmena a číslice se neuloží'
);
select throws_ok(
  $$insert into public.oem_cache (oem, source, payload, ttl)
    values ('1K0615301', 'Allegro', '[]'::jsonb, interval '1 hour')$$,
  '23514',
  'new row for relation "oem_cache" violates check constraint "oem_cache_source_check"',
  'id zdroje mimo malá písmena se neuloží'
);
select throws_ok(
  $$insert into public.oem_cache (oem, source, payload, ttl)
    values ('1K0615302', 'allegro', '[]'::jsonb, interval '0')$$,
  '23514',
  'new row for relation "oem_cache" violates check constraint "oem_cache_ttl_positive"',
  'nulové TTL se neuloží'
);
select throws_ok(
  $$insert into public.oem_cache (oem, source, payload, ttl)
    values ('1K0615301', 'allegro', '{}'::jsonb, interval '1 hour')$$,
  '23505',
  'duplicate key value violates unique constraint "oem_cache_pkey"',
  'dvojice oem a source je jen jednou'
);
select has_column('public', 'oem_cache', 'in_flight_until', 'oem_cache má lease');
select has_index('public', 'oem_cache', 'oem_cache_fetched_at_idx', 'fetched_at má index');
select throws_ok(
  $$insert into public.oem_cache (oem, source, payload, ttl)
    values ('BIGPAYLOAD1', 'allegro', to_jsonb(repeat('x', 70000)), interval '1 hour')$$,
  '23514',
  'new row for relation "oem_cache" violates check constraint "oem_cache_payload_size"',
  'příliš velký payload se neuloží'
);
select has_table('public', 'source_health', 'source_health existuje');
select has_column('public', 'source_health', 'block_count', 'source_health má počet');
select has_column('public', 'source_health', 'window_start', 'source_health má začátek okna');
select has_column('public', 'source_health', 'tripped_at', 'source_health má vypnutí');
select has_column('public', 'source_health', 'reset_at', 'source_health má ruční reset');
select ok(
  (
    select c.relrowsecurity and c.relforcerowsecurity
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'source_health'
  ),
  'source_health má vynucené RLS'
);
select ok(not has_table_privilege('anon', 'public.source_health', 'SELECT'), 'anon source_health nečte');
select ok(not has_table_privilege('authenticated', 'public.source_health', 'INSERT'), 'zákazník source_health nezapisuje');
select ok(has_table_privilege('service_role', 'public.source_health', 'SELECT'), 'service_role source_health čte');
select ok(has_table_privilege('service_role', 'public.source_health', 'UPDATE'), 'service_role source_health mění');
select is(
  (select block_count from public.record_source_block('allegro', interval '1 hour', 3)),
  1,
  'první blokace má počet 1'
);
select is(
  (select tripped from public.record_source_block('allegro', interval '1 hour', 3)),
  false,
  'dvě blokace ještě nevypnou'
);
select is(
  (select tripped from public.record_source_block('allegro', interval '1 hour', 3)),
  true,
  'třetí blokace zdroj vypne'
);
select is(
  (select block_count from public.record_source_block('allegro', interval '1 hour', 3)),
  3,
  'po vypnutí se počet dál nezvedá'
);
select lives_ok(
  $$select public.record_source_block('stale', interval '1 hour', 3)$$,
  'service_role založí počítadlo pro okno'
);
update public.source_health
set window_start = now() - interval '2 hours', block_count = 2
where source = 'stale';
select is(
  (select block_count from public.record_source_block('stale', interval '1 hour', 3)),
  1,
  'po vypršení okna se počet vrací na 1'
);
select lives_ok(
  $$select public.reset_source_health('allegro')$$,
  'service_role zdroj ručně resetuje'
);
select is(
  (select tripped_at is null from public.source_health where source = 'allegro'),
  true,
  'po resetu zdroj není vypnutý'
);
select lives_ok(
  $$insert into public.oem_cache (oem, source, payload, fetched_at, ttl)
    values ('EXPIRED1', 'allegro', '[]'::jsonb, now() - interval '2 hours', interval '1 hour')$$,
  'service_role vloží prošlý řádek'
);
select is(
  public.purge_expired_oem_cache() > 0,
  true,
  'úklid smaže prošlý řádek'
);
select is(
  public.try_lease_oem_cache('LEASE1', 'allegro', now() + interval '1 minute'),
  true,
  'volný klíč dostane lease'
);
select is(
  public.try_lease_oem_cache('LEASE1', 'allegro', now() + interval '1 minute'),
  false,
  'držený lease druhý worker nedostane'
);
reset role;

set local role anon;
select throws_ok(
  $$select * from public.record_source_block('allegro', interval '1 hour', 3)$$,
  '42501',
  'permission denied for function record_source_block',
  'anon blokaci nezapíše'
);
reset role;

select * from finish();
rollback;
