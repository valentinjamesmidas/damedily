import { describe, expect, it } from "vitest";
import vehicles from "@/data/vehicles.json";

const VANS = ["Fiat", "Peugeot", "Citroën", "Mercedes-Benz", "Volkswagen", "Ford", "Renault", "Iveco"];

describe("místní katalog vozů", () => {
  it("obsahuje dodávky ze zadání a u každé motorizace kW", () => {
    const brands = vehicles.map((item) => item.brand);
    for (const brand of VANS) expect(brands).toContain(brand);
    for (const brand of vehicles) {
      expect(brand.models.length).toBeGreaterThan(0);
      for (const model of brand.models) {
        expect(model.engines.length).toBeGreaterThan(0);
        for (const engine of model.engines) {
          expect(engine.kw).toBeGreaterThan(20);
          expect(engine.name.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
