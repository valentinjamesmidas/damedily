import { describe, expect, it } from "vitest";
import { DILOBOT_JSON_HINT, DILOBOT_SYSTEM_PROMPT } from "./dilobot";
import { LISTING_SYSTEM_PROMPT } from "./listing";
import { OFFER_RANKING_PROMPT } from "./ranking";
import { INVENTORY_VISION_PROMPT, VISION_SYSTEM_PROMPT } from "./vision";

const SUPPLIERS = ["Ovoko", "B-Parts", "Autodoc", "Inter Cars", "Auto Partner"];

describe("prompt Dílobota", () => {
  it("vyká, přizná se jako AI a nelže o původu", () => {
    expect(DILOBOT_SYSTEM_PROMPT).toMatch(/vždy mu vykej/);
    expect(DILOBOT_SYSTEM_PROMPT).toMatch(/Nikdy mu netykej/);
    expect(DILOBOT_SYSTEM_PROMPT).toMatch(/AI asistent/);
    expect(DILOBOT_SYSTEM_PROMPT).toMatch(/nejvýše tři upřesňující otázky/);
    expect(DILOBOT_SYSTEM_PROMPT).toMatch(/Na přímý dotaz na původ dílu nelži/);
    expect(DILOBOT_SYSTEM_PROMPT).toMatch(/už leží v České republice/);
    expect(DILOBOT_SYSTEM_PROMPT).toMatch(/AI skóre/);
    expect(DILOBOT_SYSTEM_PROMPT).toMatch(/VIN/);
    expect(DILOBOT_SYSTEM_PROMPT).toMatch(/OEM/);
    expect(DILOBOT_SYSTEM_PROMPT).toMatch(/4–5 pracovních dní/);
    for (const name of SUPPLIERS) {
      expect(DILOBOT_SYSTEM_PROMPT).toContain(name);
    }
  });

  it("ve strukturovaném režimu nechává zákazníkovi jen replyCs", () => {
    expect(DILOBOT_JSON_HINT).toMatch(/replyCs je jediný text/);
    expect(DILOBOT_JSON_HINT).toMatch(/0 až 3/);
    expect(DILOBOT_JSON_HINT).toMatch(/null/);
  });
});

describe("prompt překladu a vision", () => {
  it("zakazuje vymýšlet údaje, které ve zdroji nejsou", () => {
    expect(LISTING_SYSTEM_PROMPT).toMatch(/Nevymýšlej/);
    expect(LISTING_SYSTEM_PROMPT).toMatch(/nastav na null/);
    expect(LISTING_SYSTEM_PROMPT).toContain('"pouzity"');
    expect(LISTING_SYSTEM_PROMPT).toContain('"novy"');
    expect(LISTING_SYSTEM_PROMPT).toContain('"oem"');
    expect(LISTING_SYSTEM_PROMPT).toContain('"druhovyroba"');
    expect(LISTING_SYSTEM_PROMPT).toMatch(/AI skóre/);
    for (const name of SUPPLIERS) {
      expect(LISTING_SYSTEM_PROMPT).toContain(name);
    }
  });

  it("drží jistotu z fotky jen interně", () => {
    expect(VISION_SYSTEM_PROMPT).toMatch(/confidence a partTypeConfidence/);
    expect(VISION_SYSTEM_PROMPT).toMatch(/Ta pole jsou interní/);
    expect(VISION_SYSTEM_PROMPT).toMatch(/Nevymýšlej OEM/);
    expect(VISION_SYSTEM_PROMPT).toMatch(/AI skóre/);
    expect(VISION_SYSTEM_PROMPT).toMatch(/v České republice/);
    for (const name of SUPPLIERS) {
      expect(VISION_SYSTEM_PROMPT).toContain(name);
    }
  });

  it("předvyplnění skladu nevymýšlí OEM a nevrací jistotu", () => {
    expect(INVENTORY_VISION_PROMPT).toMatch(/OEM nevymýšlej/);
    expect(INVENTORY_VISION_PROMPT).toMatch(/null/);
    expect(INVENTORY_VISION_PROMPT).toMatch(/AI skóre/);
    expect(INVENTORY_VISION_PROMPT).toMatch(/nákupní cenu/);
    expect(INVENTORY_VISION_PROMPT).not.toMatch(/confidence/);
  });
});

describe("prompt řazení alternativ", () => {
  it("nesmí vymýšlet díly ani skóre pro zákazníka", () => {
    expect(OFFER_RANKING_PROMPT).toMatch(/Nic dalšího nevymýšlej/);
    expect(OFFER_RANKING_PROMPT).toMatch(/alternativeIds/);
    expect(OFFER_RANKING_PROMPT).toMatch(/AI skóre/);
    expect(OFFER_RANKING_PROMPT).toMatch(/nejvýše dvě/);
  });
});
