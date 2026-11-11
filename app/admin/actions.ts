"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/session";
import type { ActionResult } from "@/lib/inventory/action-result";
import { validateInventoryInput, type InventoryInput } from "@/lib/inventory/item-input";
import { isOwnInventoryImage } from "@/lib/inventory/public";
import { publicSupabaseEnv } from "@/lib/supabase/env";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function rowFrom(input: InventoryInput, images: string[]) {
  return {
    title_cs: input.titleCs,
    oem_number: input.oemNumber,
    part_category: input.partCategory,
    vehicle_compatibility: input.vehicleText ? [{ text: input.vehicleText }] : [],
    tire_specs: input.tireSpecs
      ? {
          width: input.tireSpecs.width,
          profile: input.tireSpecs.profile,
          diameter: input.tireSpecs.diameter,
          load_index: input.tireSpecs.loadIndex,
          season: input.tireSpecs.season,
        }
      : null,
    cost_price_czk: input.costPriceCzk,
    selling_price_czk: input.sellingPriceCzk,
    stock_quantity: input.stockQuantity,
    placement_type: input.placementType,
    internal_project_tag: input.internalProjectTag,
    images,
    part_condition: input.partCondition,
    origin_kind: input.originKind,
    condition_detail: input.conditionDetail,
  };
}

function ownImages(images: readonly string[]): string[] | null {
  const env = publicSupabaseEnv();
  const kept: string[] = [];
  for (const image of images) {
    if (!isOwnInventoryImage(image, env?.url ?? null)) return null;
    kept.push(image);
  }
  return kept;
}

export async function saveInventoryItem(formData: FormData): Promise<ActionResult> {
  const access = await requireAdmin();
  if (!access.ok) return { ok: false, message: access.message };

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    return { ok: false, message: "Formulář je nečitelný." };
  }
  const parsed = validateInventoryInput(payload);
  if (!parsed.ok) return parsed;

  const images = ownImages(parsed.value.images);
  if (!images) return { ok: false, message: "Fotka musí být z našeho úložiště." };

  const photos = formData.getAll("photos").filter((item): item is File => item instanceof File && item.size > 0);
  if (photos.length + images.length > 8) return { ok: false, message: "Nejvýš 8 fotek." };

  const uploaded = [...images];
  for (const photo of photos) {
    const extension = PHOTO_TYPES.get(photo.type);
    if (!extension || photo.size > MAX_PHOTO_BYTES) {
      return { ok: false, message: "Fotka musí být JPEG, PNG nebo WebP do 5 MB." };
    }
    const path = `${crypto.randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const { error } = await access.supabase.storage.from("inventory-images").upload(path, bytes, {
      contentType: photo.type,
      upsert: false,
    });
    if (error) {
      return { ok: false, message: "Fotku se nepodařilo nahrát. Údaje můžete uložit znovu i bez ní." };
    }
    const { data } = access.supabase.storage.from("inventory-images").getPublicUrl(path);
    uploaded.push(data.publicUrl);
  }

  const row = rowFrom(parsed.value, uploaded);
  const query = parsed.value.id
    ? access.supabase.from("inventory_items").update(row).eq("id", parsed.value.id)
    : access.supabase.from("inventory_items").insert(row);
  const { error } = await query;
  if (error) return { ok: false, message: "Položku se nepodařilo uložit." };

  revalidatePath("/");
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteInventoryItem(id: string): Promise<ActionResult> {
  const access = await requireAdmin();
  if (!access.ok) return { ok: false, message: access.message };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return { ok: false, message: "Položka není platná." };
  }
  const { error } = await access.supabase.from("inventory_items").delete().eq("id", id);
  if (error) return { ok: false, message: "Položku se nepodařilo smazat." };
  revalidatePath("/");
  revalidatePath("/admin");
  return { ok: true };
}
