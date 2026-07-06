import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { pharmacyTerm } from "./pharmacyTerms";
import {
  PHARMACY_FORBIDDEN_RETAIL_TERMS,
  inferProductGuess,
  posSearchAliases,
  textContainsRetailLeak,
  uiPlaceholder,
} from "./pharmacyUx";
import { starterPackForBusinessType } from "../data/starterPacks";

describe("pharmacy isolation — placeholders", () => {
  it("pharmacy mode uses medicine examples not retail", () => {
    const namePh = uiPlaceholder("en", "pharmacy", "simpleAddStep1Example", true);
    expect(textContainsRetailLeak(namePh)).toBeNull();
    expect(namePh.toLowerCase()).toContain("paracetamol");

    const shelfPh = uiPlaceholder("en", "pharmacy", "simpleAddShelfPlaceholder", true);
    expect(textContainsRetailLeak(shelfPh)).toBeNull();
    expect(shelfPh.toLowerCase()).toMatch(/pain relief|antibiotics/);
  });

  it("retail mode keeps classic retail examples", () => {
    const nameRetail = uiPlaceholder("en", "kiosk_duka", "simpleAddStep1Example", false);
    expect(nameRetail.toLowerCase()).toContain("coca cola");
    expect(t("en", "simpleAddStep1Example").toLowerCase()).toContain("sugar");
  });
});

describe("pharmacy isolation — search aliases", () => {
  it("pharmacy aliases exclude beverage terms", () => {
    const aliases = posSearchAliases("pharmacy", true);
    expect(aliases.soda).toBeUndefined();
    expect(aliases.paracetamol).toBeDefined();
    expect(aliases.amoxicillin).toBeDefined();
    expect(aliases.ibuprofen).toBeDefined();
  });

  it("retail aliases still include soda", () => {
    const aliases = posSearchAliases("kiosk_duka", false);
    expect(aliases.soda).toBeDefined();
    expect(aliases.soda!.some((x) => x.includes("coke"))).toBe(true);
  });
});

describe("pharmacy isolation — product guess", () => {
  it("pharmacy guess does not return crate for cola-like names", () => {
    const guess = inferProductGuess("coca cola", "pharmacy", true);
    expect(guess.buyingUnit).not.toBe("crate");
    expect(guess.baseUnit).not.toBe("bottle");
  });

  it("retail guess still maps soda to bottle/crate", () => {
    const guess = inferProductGuess("coke", "kiosk_duka", false);
    expect(guess.buyingUnit).toBe("crate");
  });

  it("pharmacy paracetamol defaults to tablet unit", () => {
    const guess = inferProductGuess("Paracetamol", "pharmacy", true);
    expect(guess.baseUnit).toBe("tablet");
    expect(guess.sellingMode).toBe("unit");
  });
});

describe("pharmacy isolation — starter pack", () => {
  it("pharmacy starter has only medicine lines", () => {
    const pack = starterPackForBusinessType("pharmacy");
    expect(pack.length).toBeGreaterThanOrEqual(8);
    const inferNames = pack.map((l) => l.inferName.toLowerCase()).join(" ");
    expect(inferNames).toMatch(/paracetamol|amoxicillin|ibuprofen/);
    for (const term of ["soda", "beer", "pilau", "sugar", "soap"]) {
      expect(inferNames).not.toContain(term);
    }
  });

  it("kiosk starter still includes retail items", () => {
    const pack = starterPackForBusinessType("kiosk_duka");
    expect(pack.some((l) => l.inferName.toLowerCase().includes("soda"))).toBe(true);
  });
});

describe("pharmacy isolation — forbidden term list", () => {
  it("covers audit vocabulary from product sprint", () => {
    for (const term of ["coca cola", "drinks", "crate", "carton", "beer"]) {
      expect(PHARMACY_FORBIDDEN_RETAIL_TERMS.some((t) => t === term)).toBe(true);
    }
  });
});

describe("pharmacy isolation — terminology", () => {
  it("maps stock and sell to medicine vocabulary", () => {
    expect(pharmacyTerm("en", "pharmacy", "stock", true).toLowerCase()).toContain("medicine");
    expect(pharmacyTerm("en", "pharmacy", "sell", true).toLowerCase()).toContain("dispense");
    expect(pharmacyTerm("en", "pharmacy", "receipts", true).toLowerCase()).toContain("dispensing");
  });

  it("retail keeps generic product wording", () => {
    expect(pharmacyTerm("en", "kiosk_duka", "stock", false).toLowerCase()).toContain("inventory");
    expect(pharmacyTerm("en", "kiosk_duka", "sell", false).toLowerCase()).not.toContain("dispense");
  });
});

describe("pharmacy isolation — retail leak detector", () => {
  it("flags known retail examples", () => {
    expect(textContainsRetailLeak("e.g. Coca Cola, Sugar")).toBe("coca cola");
    expect(textContainsRetailLeak("Paracetamol 500mg")).toBeNull();
  });

  it("pharmacy i18n placeholders pass leak scan", () => {
    const keys = [
      "pharmacyPlaceholder_nameExample",
      "pharmacyPlaceholder_categoryExample",
      "pharmacyPlaceholder_categoryHint",
    ] as const;
    for (const key of keys) {
      const text = t("en", key);
      expect(textContainsRetailLeak(text)).toBeNull();
    }
  });
});

describe("pharmacy isolation — hospitality unchanged", () => {
  it("restaurant business type does not use pharmacy aliases", () => {
    const aliases = posSearchAliases("restaurant", false, true);
    expect(aliases.pilau).toBeDefined();
    expect(aliases.paracetamol).toBeUndefined();
  });
});
