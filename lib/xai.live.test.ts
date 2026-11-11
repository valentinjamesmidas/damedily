import { describe, expect, it } from "vitest";
import { createXaiClient } from "./xai-grok";

const apiKey = process.env.XAI_API_KEY?.trim() ?? "";

if (!apiKey) {
  console.info("XAI_API_KEY není nastavený, živý smoke test se přeskočí.");
}

describe.skipIf(!apiKey)("živý smoke test xAI", () => {
  it("dostane neprázdnou textovou odpověď z chat completions", async () => {
    const client = createXaiClient({ apiKey, maxRetries: 0, timeoutMs: 120_000 });
    const result = await client.chat({
      purpose: "text",
      messages: [
        {
          role: "user",
          content: "Odpověz jediným českým slovem ano. Nic dalšího nepřidávej.",
        },
      ],
    });

    expect(result.model.length).toBeGreaterThan(0);
    expect(result.content?.trim().length ?? 0).toBeGreaterThan(0);
    expect(result.content ?? "").not.toContain(apiKey);
  });
});
