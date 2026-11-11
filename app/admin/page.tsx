import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminAccess } from "@/components/admin/admin-access";
import { InventoryManager } from "@/components/admin/inventory-manager";
import { requireAdmin } from "@/lib/admin/session";
import { parseAdminItems } from "@/lib/inventory/admin-item";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sklad",
};

export default async function AdminPage() {
  const access = await requireAdmin();
  if (!access.ok) {
    if (access.status === 403) redirect("/admin/pristup");
    redirect(access.status === 503 ? "/admin/prihlaseni?chyba=konfigurace" : "/admin/prihlaseni");
  }

  const { data, error } = await access.supabase
    .from("inventory_items")
    .select(
      "id,title_cs,oem_number,part_category,vehicle_compatibility,tire_specs,cost_price_czk,selling_price_czk,stock_quantity,placement_type,internal_project_tag,images,part_condition,origin_kind,condition_detail",
    )
    .order("created_at", { ascending: false });

  return (
    <AdminAccess status="admin">
      <InventoryManager items={parseAdminItems(data ?? [])} loadError={Boolean(error)} />
    </AdminAccess>
  );
}
