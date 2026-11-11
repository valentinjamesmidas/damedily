import { describe, expect, it } from "vitest";
import { XaiError } from "@/lib/xai-grok";
import { modelUnavailableMessage } from "./model-error";

describe("hláška nedostupného modelu", () => {
  it("u HTTP 402 řekne o kreditu a nepropustí tělo odpovědi", () => {
    const message = modelUnavailableMessage(
      new XaiError("xAI vrátilo HTTP 402: secret-body", { status: 402 }),
      "Rozpoznání z fotky",
    );
    expect(message).toMatch(/nemá kredit/);
    expect(message).not.toContain("secret-body");
  });
});
