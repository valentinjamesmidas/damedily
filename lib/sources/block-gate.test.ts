import { describe, expect, it } from "vitest";
import { BlockGate, readBlockThreshold, sourceFlagEnabled } from "./block-gate";

describe("sourceFlagEnabled", () => {
  it("chybějící proměnnou bere jako zapnuto", () => {
    expect(sourceFlagEnabled("allegro", {})).toBe(true);
    expect(sourceFlagEnabled("allegro", { SOURCE_ALLEGRO: "  " })).toBe(true);
  });

  it("zná zapnuto a vypnuto", () => {
    expect(sourceFlagEnabled("allegro", { SOURCE_ALLEGRO: "1" })).toBe(true);
    expect(sourceFlagEnabled("allegro", { SOURCE_ALLEGRO: "true" })).toBe(true);
    expect(sourceFlagEnabled("allegro", { SOURCE_ALLEGRO: "YES" })).toBe(true);
    expect(sourceFlagEnabled("allegro", { SOURCE_ALLEGRO: "0" })).toBe(false);
    expect(sourceFlagEnabled("allegro", { SOURCE_ALLEGRO: "false" })).toBe(false);
    expect(sourceFlagEnabled("allegro", { SOURCE_ALLEGRO: "no" })).toBe(false);
    expect(sourceFlagEnabled("allegro", { SOURCE_ALLEGRO: "2" })).toBe(false);
  });

  it("divné id odmítne", () => {
    expect(() => sourceFlagEnabled("Allegro", {})).toThrow(/Id zdroje/);
  });
});

describe("readBlockThreshold", () => {
  it("bez proměnné vrátí 3 a rozbitou hodnotu odmítne", () => {
    expect(readBlockThreshold({})).toBe(3);
    expect(readBlockThreshold({ SOURCE_BLOCK_THRESHOLD: "1" })).toBe(1);
    expect(() => readBlockThreshold({ SOURCE_BLOCK_THRESHOLD: "-1" })).toThrow(/SOURCE_BLOCK_THRESHOLD/);
    expect(() => readBlockThreshold({ SOURCE_BLOCK_THRESHOLD: "1.5" })).toThrow(/SOURCE_BLOCK_THRESHOLD/);
  });
});

describe("BlockGate", () => {
  it("po dosažení prahu zdroj vypne a zapíše to jednou", () => {
    const lines: string[] = [];
    const gate = new BlockGate(3, (message) => lines.push(message));
    gate.record("allegro", "http-403");
    gate.record("allegro", "captcha");
    expect(gate.isTripped("allegro")).toBe(false);
    expect(lines).toEqual([]);
    gate.record("allegro", "http-403");
    expect(gate.isTripped("allegro")).toBe(true);
    expect(gate.count("allegro")).toBe(3);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("allegro");
    expect(lines[0]).toContain("neobcházíme");
    gate.record("allegro", "captcha");
    expect(lines).toHaveLength(1);
    expect(gate.isTripped("jiny")).toBe(false);
  });

  it("staré odpovědi mimo okno se do prahu nepočítají a reset vypnutí smaže", () => {
    let now = new Date("2026-11-24T12:00:00.000Z");
    const gate = new BlockGate(3, () => {}, 60_000, () => now);
    gate.record("allegro", "http-403");
    gate.record("allegro", "http-403");
    now = new Date("2026-11-24T12:02:00.000Z");
    gate.record("allegro", "captcha");
    expect(gate.count("allegro")).toBe(1);
    expect(gate.isTripped("allegro")).toBe(false);
    gate.record("allegro", "http-403");
    gate.record("allegro", "http-403");
    expect(gate.isTripped("allegro")).toBe(true);
    gate.reset("allegro");
    expect(gate.isTripped("allegro")).toBe(false);
    expect(gate.count("allegro")).toBe(0);
  });
});
