-- Krok 4. Popis stavu je veřejný údaj o kusu. Fotky skladu jdou do bucketu
-- inventory-images: čtení je veřejné, zápis jen pro roli admin (private.is_admin).

alter table public.inventory_items
  add column condition_detail text;

comment on column public.inventory_items.condition_detail is
  'Popis stavu pro zákazníka. Není to nákupní cena, interní tag ani zdroj.';

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
  origin_kind,
  condition_detail
from public.inventory_items;

comment on view public.public_inventory is
  'Veřejný sklad bez nákupní ceny, tagu a kompaktního OEM. Stav, původ a popis stavu vidět jsou.';

grant select on table public.public_inventory to anon, authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'inventory-images',
  'inventory-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists inventory_images_public_read on storage.objects;
create policy inventory_images_public_read
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'inventory-images');

drop policy if exists inventory_images_admin_insert on storage.objects;
create policy inventory_images_admin_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'inventory-images'
    and (select private.is_admin())
  );

drop policy if exists inventory_images_admin_update on storage.objects;
create policy inventory_images_admin_update
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'inventory-images'
    and (select private.is_admin())
  )
  with check (
    bucket_id = 'inventory-images'
    and (select private.is_admin())
  );

drop policy if exists inventory_images_admin_delete on storage.objects;
create policy inventory_images_admin_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'inventory-images'
    and (select private.is_admin())
  );
