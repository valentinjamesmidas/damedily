import { HomeExperience } from "@/components/home/home-experience";
import { loadPublicInventory } from "@/lib/inventory/public";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const items = await loadPublicInventory();
  return <HomeExperience items={items} />;
}
