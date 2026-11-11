begin;

create extension if not exists pgtap with schema extensions;

select plan(78);

-- ---------------------------------------------------------------------------
-- Katalog
-- ---------------------------------------------------------------------------

select has_table('public', 'profiles', 'profiles existují');
select has_table('public', 'inventory_items', 'inventory_items existují');
select has_table('public', 'search_sessions', 'search_sessions existují');
select has_table('public', 'orders', 'orders existují');
select has_table('public', 'order_items', 'order_items existují');
select has_view('public', 'public_inventory', 'public_inventory je view');
select has_view('public', 'customer_order_items', 'customer_order_items je view');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles'),
  'profiles mají vynucené RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'inventory_items'),
  'inventory_items mají vynucené RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'search_sessions'),
  'search_sessions mají vynucené RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'orders'),
  'orders mají vynucené RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'order_items'),
  'order_items mají vynucené RLS'
);

select has_column('public', 'public_inventory', 'selling_price_czk', 'view skladu má prodejní cenu');
select hasnt_column('public', 'public_inventory', 'cost_price_czk', 'view skladu nemá nákupní cenu');
select hasnt_column('public', 'public_inventory', 'internal_project_tag', 'view skladu nemá interní tag');
select hasnt_column('public', 'public_inventory', 'source_platform', 'view skladu nemá zdroj');
select hasnt_column('public', 'public_inventory', 'supplier_order_ref', 'view skladu nemá referenci dodavatele');
select has_column('public', 'inventory_items', 'part_condition', 'sklad umí uložit použitý nebo nový');
select has_column('public', 'inventory_items', 'origin_kind', 'sklad umí uložit OEM nebo druhovýrobu');
select has_column('public', 'inventory_items', 'oem_compact', 'sklad má kompaktní OEM pro hledání');
select has_column('public', 'public_inventory', 'part_condition', 'veřejný sklad ukazuje, jestli je díl použitý nebo nový');
select has_column('public', 'public_inventory', 'origin_kind', 'veřejný sklad ukazuje OEM nebo druhovýrobu');
select hasnt_column('public', 'public_inventory', 'oem_compact', 'veřejný sklad kompaktní OEM neukazuje');
select ok(
  (
    select not attnotnull
    from pg_attribute
    where attrelid = 'public.search_sessions'::regclass
      and attname = 'user_id'
      and not attisdropped
  ),
  'search_sessions.user_id smí být prázdné'
);

select has_column('public', 'customer_order_items', 'selling_price_czk', 'zákaznické položky mají prodejní cenu');
select hasnt_column('public', 'customer_order_items', 'cost_price_czk', 'zákaznické položky nemají nákupní cenu');
select hasnt_column('public', 'customer_order_items', 'internal_project_tag', 'zákaznické položky nemají interní tag');
select hasnt_column('public', 'customer_order_items', 'source_platform', 'zákaznické položky nemají zdroj');
select hasnt_column('public', 'customer_order_items', 'supplier_order_ref', 'zákaznické položky nemají referenci dodavatele');

select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'orders_total_amount_czk_min'
      and contype = 'c'
  ),
  'objednávka má CHECK na minimum 2 000 Kč'
);

-- ---------------------------------------------------------------------------
-- Data. Vkládá postgres, který obchází RLS. Trigger na auth.users založí profil.
-- ---------------------------------------------------------------------------

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
) values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'zakaznik@damedily.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin@damedily.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'jiny@damedily.test',
    '',
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

update public.profiles
set role = 'admin'
where id = '22222222-2222-4222-8222-222222222222';

insert into public.inventory_items (
  id,
  title_cs,
  oem_number,
  part_category,
  cost_price_czk,
  selling_price_czk,
  stock_quantity,
  placement_type,
  internal_project_tag
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Brzdový kotouč',
  'OEM-123',
  'Brzdy',
  100.00,
  150.00,
  4,
  'action_offer',
  'damedily'
);

select throws_ok(
  $$insert into public.inventory_items (
      title_cs, oem_number, part_category, cost_price_czk, selling_price_czk,
      placement_type, internal_project_tag, part_condition
    ) values (
      'Špatný stav', 'OEM-BAD', 'Brzdy', 10, 20, 'action_offer', 'damedily', 'rozbity'
    )$$,
  '23514',
  'new row for relation "inventory_items" violates check constraint "inventory_items_part_condition_check"',
  'neznámý stav dílu neprojde'
);

insert into public.orders (id, order_number, user_id, total_amount_czk)
values
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'DD-TEST-1',
    '11111111-1111-4111-8111-111111111111',
    2500
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'DD-TEST-2',
    '33333333-3333-4333-8333-333333333333',
    2500
  );

insert into public.order_items (
  id,
  order_id,
  item_title_cs,
  oem_number,
  source_platform,
  supplier_order_ref,
  internal_project_tag,
  cost_price_czk,
  selling_price_czk,
  quantity
) values
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Brzdový kotouč',
    'OEM-123',
    'ovoko',
    'SUP-SECRET-RLS-991',
    'ekokladno',
    80.00,
    150.00,
    1
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Jiná položka',
    'OEM-999',
    'autodoc',
    'SUP-SECRET-RLS-992',
    'damedily',
    90.00,
    140.00,
    1
  );

insert into public.search_sessions (id, user_id, query_type, raw_query, status)
values
  (
    'abababab-abab-4aba-8aba-abababababab',
    '11111111-1111-4111-8111-111111111111',
    'chat',
    'kotouč na Octavii',
    'completed'
  ),
  (
    'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd',
    '33333333-3333-4333-8333-333333333333',
    'catalog',
    'filtr oleje',
    'first_found'
  );

insert into public.search_sessions (id, user_id, query_type, raw_query, status, results)
values (
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  null,
  'catalog',
  'anonymní hledání',
  'completed',
  '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Anon: přímý SELECT na tabulky je zakázaný, sklad jen přes view.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_ok(
  'select id from public.inventory_items',
  '42501',
  'permission denied for table inventory_items',
  'anon nesmí číst inventory_items'
);
select throws_ok(
  'select cost_price_czk, internal_project_tag from public.inventory_items',
  '42501',
  'permission denied for table inventory_items',
  'anon nesmí číst nákupní cenu ani tag skladu'
);
select throws_ok(
  'select source_platform, supplier_order_ref, cost_price_czk, internal_project_tag from public.order_items',
  '42501',
  'permission denied for table order_items',
  'anon nesmí číst order_items'
);
select throws_ok(
  'select id from public.orders',
  '42501',
  'permission denied for table orders',
  'anon nesmí číst orders'
);
select throws_ok(
  'select id from public.profiles',
  '42501',
  'permission denied for table profiles',
  'anon nesmí číst profiles'
);
select throws_ok(
  'select id from public.search_sessions',
  '42501',
  'permission denied for table search_sessions',
  'anon nesmí číst search_sessions'
);
select throws_ok(
  'select id from public.customer_order_items',
  '42501',
  'permission denied for view customer_order_items',
  'anon nesmí číst zákaznické položky objednávky'
);

select is(
  (
    select selling_price_czk
    from public.public_inventory
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  150.00::numeric,
  'anon vidí prodejní cenu ve veřejném skladu'
);
select throws_ok(
  'select cost_price_czk from public.public_inventory',
  '42703',
  'column "cost_price_czk" does not exist',
  'veřejný sklad sloupec nákupní ceny nemá'
);
select ok(
  (
    select bool_and(
      not (
        to_jsonb(v) ?| array[
          'cost_price_czk',
          'internal_project_tag',
          'source_platform',
          'supplier_order_ref'
        ]
      )
      and to_jsonb(v)::text not like '%ekokladno%'
      and to_jsonb(v)::text not like '%damedily%'
      and to_jsonb(v)::text not like '%ovoko%'
      and to_jsonb(v)::text not like '%SUP-SECRET-RLS-%'
    )
    from public.public_inventory as v
  ),
  'řádky veřejného skladu neobsahují citlivé klíče ani skryté hodnoty'
);

-- ---------------------------------------------------------------------------
-- Zákazník
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
set local role authenticated;

select is_empty(
  'select id from public.inventory_items',
  'zákazník z inventory_items nedostane žádný řádek'
);
select is_empty(
  'select cost_price_czk from public.inventory_items',
  'zákazník nedostane nákupní cenu skladu'
);
select is_empty(
  $$select id from public.inventory_items where internal_project_tag = 'damedily'$$,
  'zákazník podle interního tagu sklad nevyhledá'
);
select is_empty(
  'select source_platform, supplier_order_ref, cost_price_czk, internal_project_tag from public.order_items',
  'zákazník z order_items nedostane citlivé sloupce'
);

select is(
  (
    select selling_price_czk
    from public.public_inventory
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  150.00::numeric,
  'zákazník vidí prodejní cenu ve veřejném skladu'
);
select ok(
  (
    select bool_and(
      not (
        to_jsonb(v) ?| array[
          'cost_price_czk',
          'internal_project_tag',
          'source_platform',
          'supplier_order_ref'
        ]
      )
      and to_jsonb(v)::text not like '%ekokladno%'
      and to_jsonb(v)::text not like '%damedily%'
      and to_jsonb(v)::text not like '%SUP-SECRET-RLS-%'
    )
    from public.public_inventory as v
  ),
  'zákazníkův veřejný sklad neobsahuje citlivé hodnoty'
);

select is(
  (select email from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'zakaznik@damedily.test',
  'zákazník vidí vlastní profil'
);
select is_empty(
  $$select id from public.profiles where id = '33333333-3333-4333-8333-333333333333'$$,
  'zákazník nevidí cizí profil'
);
select throws_ok(
  $$update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111'$$,
  '42501',
  'Změna role je povolená jen administrátorovi.',
  'zákazník si nemůže povýšit roli'
);
select is(
  (select role::text from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'customer',
  'role zákazníka zůstala customer'
);
select is_empty(
  $$update public.profiles set full_name = 'Cizí' where id = '33333333-3333-4333-8333-333333333333' returning 1$$,
  'zákazník neupraví cizí profil'
);

select lives_ok(
  $$insert into public.search_sessions (user_id, query_type, raw_query, status)
    values ('11111111-1111-4111-8111-111111111111', 'photo', 'foto dílu', 'searching_alternatives')$$,
  'zákazník založí vlastní vyhledávání'
);
select is_empty(
  $$select id from public.search_sessions where id = 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd'$$,
  'zákazník nevidí cizí vyhledávání'
);
select is_empty(
  $$select id from public.search_sessions where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'$$,
  'zákazník nevidí anonymní hledání'
);
select throws_ok(
  $$insert into public.search_sessions (user_id, query_type, raw_query, status)
    values ('33333333-3333-4333-8333-333333333333', 'chat', 'cizí', 'first_found')$$,
  '42501',
  'new row violates row-level security policy for table "search_sessions"',
  'zákazník nezaloží vyhledávání jinému uživateli'
);

select throws_ok(
  $$insert into public.orders (order_number, user_id, total_amount_czk)
    values ('DD-LOW-1999', '11111111-1111-4111-8111-111111111111', 1999)$$,
  '23514',
  'new row for relation "orders" violates check constraint "orders_total_amount_czk_min"',
  'objednávka za 1 999 Kč neprojde CHECK'
);
select throws_ok(
  $$insert into public.orders (order_number, user_id, total_amount_czk)
    values ('DD-LOW-HALERE', '11111111-1111-4111-8111-111111111111', 1999.99)$$,
  '23514',
  'new row for relation "orders" violates check constraint "orders_total_amount_czk_min"',
  'objednávka za 1 999,99 Kč neprojde CHECK'
);
select lives_ok(
  $$insert into public.orders (order_number, user_id, total_amount_czk)
    values ('DD-OK-2000', '11111111-1111-4111-8111-111111111111', 2000)$$,
  'objednávka přesně za 2 000 Kč projde'
);
select throws_ok(
  $$insert into public.orders (order_number, user_id, total_amount_czk)
    values ('DD-CIZI', '33333333-3333-4333-8333-333333333333', 2500)$$,
  '42501',
  'new row violates row-level security policy for table "orders"',
  'zákazník nezaloží objednávku jinému uživateli'
);

select is(
  (select count(*)::int from public.orders where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1,
  'zákazník vidí vlastní objednávku'
);
select is(
  (select count(*)::int from public.orders where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  0,
  'zákazník nevidí cizí objednávku'
);
select is_empty(
  $$update public.orders set payment_status = 'captured' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning 1$$,
  'zákazník nemění stav platby'
);

select is(
  (
    select count(*)::int
    from public.customer_order_items
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      and selling_price_czk = 150
  ),
  1,
  'zákazník vidí vlastní položku a její prodejní cenu'
);
select is(
  (select count(*)::int from public.customer_order_items where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
  0,
  'zákazník nevidí cizí položku'
);
select throws_ok(
  'select source_platform from public.customer_order_items',
  '42703',
  'column "source_platform" does not exist',
  'zákaznické view zdroj položky nemá'
);
select throws_ok(
  'select supplier_order_ref from public.customer_order_items',
  '42703',
  'column "supplier_order_ref" does not exist',
  'zákaznické view referenci dodavatele nemá'
);
select ok(
  (
    select bool_and(
      not (
        to_jsonb(v) ?| array[
          'cost_price_czk',
          'internal_project_tag',
          'source_platform',
          'supplier_order_ref'
        ]
      )
      and to_jsonb(v)::text not like '%ekokladno%'
      and to_jsonb(v)::text not like '%ovoko%'
      and to_jsonb(v)::text not like '%autodoc%'
      and to_jsonb(v)::text not like '%SUP-SECRET-RLS-%'
    )
    from public.customer_order_items as v
  ),
  'zákaznické položky neobsahují citlivé klíče ani skryté hodnoty'
);

-- ---------------------------------------------------------------------------
-- Admin vidí všechno
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (
    select cost_price_czk
    from public.inventory_items
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  100.00::numeric,
  'admin vidí nákupní cenu skladu'
);
select is(
  (
    select internal_project_tag::text
    from public.inventory_items
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  'damedily',
  'admin vidí interní tag skladu'
);
select is(
  (
    select source_platform::text
    from public.order_items
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ),
  'ovoko',
  'admin vidí zdroj položky'
);
select is(
  (
    select supplier_order_ref
    from public.order_items
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ),
  'SUP-SECRET-RLS-991',
  'admin vidí referenci dodavatele'
);
select is(
  (
    select cost_price_czk
    from public.order_items
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  ),
  80.00::numeric,
  'admin vidí nákupní cenu položky'
);
select is(
  (
    select internal_project_tag::text
    from public.order_items
    where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  ),
  'damedily',
  'admin vidí tag cizí položky'
);
select is(
  (select count(*)::int from public.profiles),
  3,
  'admin vidí všechny profily'
);
select is(
  (select count(*)::int from public.orders where order_number in ('DD-TEST-1', 'DD-TEST-2')),
  2,
  'admin vidí objednávky obou zákazníků'
);
select is(
  (select count(*)::int from public.search_sessions where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
  1,
  'admin vidí anonymní hledání'
);
select results_eq(
  $$update public.profiles
    set role = 'admin'
    where id = '33333333-3333-4333-8333-333333333333'
    returning role::text$$,
  array['admin'],
  'admin může změnit roli'
);

select * from finish();
rollback;
