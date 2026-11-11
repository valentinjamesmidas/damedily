/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { INSPECTION_SEAL } from "@/lib/copy";
import { OfferCard } from "./offer-card";

afterEach(() => cleanup());

describe("karta nabídky", () => {
  it("ukáže stav, OEM, cenu, lhůtu a pečeť a nikde zdroj, skóre ani nákup", () => {
    render(
      <OfferCard
        item={{
          title: "Brzdový kotouč",
          conditionLabel: "Nový",
          originLabel: "Druhovýroba",
          conditionDetail: "Nový, bez koroze na třecí ploše.",
          oemNumber: "1K0615301",
          priceCzk: 2100,
          deliveryLeadTime: "4–5 pracovních dní",
          badge: null,
          imageUrl: null,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Brzdový kotouč" })).toBeTruthy();
    expect(screen.getByText(/Nový · Druhovýroba/)).toBeTruthy();
    expect(screen.getByText("1K0615301")).toBeTruthy();
    expect(screen.getByText(/4–5 pracovních dní/)).toBeTruthy();
    expect(screen.getByText(INSPECTION_SEAL)).toBeTruthy();

    const text = document.body.textContent ?? "";
    for (const forbidden of [
      "Ovoko",
      "B-Parts",
      "B Parts",
      "Autodoc",
      "Inter Cars",
      "Auto Partner",
      "AI skóre",
      "nákupní",
      "cost_price",
      "internal_project_tag",
      "source_platform",
      "ekokladno",
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
