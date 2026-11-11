import { XaiError } from "@/lib/xai-grok";

export function modelUnavailableMessage(error: unknown, action: string): string {
  if (error instanceof XaiError && error.status === 402) {
    return `${action} teď není dostupné, protože služba modelu nemá kredit.`;
  }
  if (error instanceof XaiError && !error.status) {
    return `${action} teď není dostupné.`;
  }
  return `${action} teď není dostupné.`;
}
