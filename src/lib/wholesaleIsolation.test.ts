import { describe, expect, it } from "vitest";
import { starterPackForBusinessType } from "../data/starterPacks";
import { t } from "./i18n";
import { posSearchAliases, inferProductGuess, uiPlaceholder } from "./pharmacyUx";
import { wholesaleTerm } from "./wholesaleTerms";
import { isWholesaleMode } from "./wholesale";

describe("wholesale isolation — mode source of truth", () => {
  it("enables wholesale mode only for wholesale business type", () => {
    expect(isWholesaleMode("wholesale")).toBe(true);
    expect(isWholesaleMode("kiosk_duka")).toBe(false);
    expect(isWholesaleMode("pharmacy")).toBe(false);
    expect(isWholesaleMode("restaurant")).toBe(false);
  });
});

describe("wholesale isolation — placeholders", () => {
  it("uses wholesale examples in quick add and wizard hints", () => {
    const nameHint = uiPlaceholder("en", "wholesale", "simpleAddStep1Example");
    const categoryHint = uiPlaceholder("en", "wholesale", "quickAddStep2Ph");
    expect(nameHint.toLowerCase()).toContain("rice 25kg bag");
    expect(nameHint.toLowerCase()).toContain("sugar 50kg sack");
    expect(categoryHint.toLowerCase()).toContain("grains");
  });

  it("does not leak pharmacy terminology in wholesale placeholders", () => {
    const nameHint = uiPlaceholder("en", "wholesale", "simpleAddStep1Example");
    expect(nameHint.toLowerCase()).not.toContain("paracetamol");
    expect(nameHint.toLowerCase()).not.toContain("amoxicillin");
    expect(nameHint.toLowerCase()).not.toContain("patient");
  });

  it("does not leak hospitality terminology in wholesale placeholders", () => {
    const hint = uiPlaceholder("en", "wholesale", "simpleAddStep2Hint");
    expect(hint.toLowerCase()).not.toContain("table");
    expect(hint.toLowerCase()).not.toContain("kitchen");
    expect(hint.toLowerCase()).not.toContain("waiter");
  });
});

describe("wholesale isolation — terminology", () => {
  it("maps core labels to wholesale language", () => {
    expect(wholesaleTerm("en", "wholesale", "sale").toLowerCase()).toContain("invoice");
    expect(wholesaleTerm("en", "wholesale", "customers").toLowerCase()).toContain("account");
    expect(wholesaleTerm("en", "wholesale", "stock").toLowerCase()).toContain("warehouse");
    expect(wholesaleTerm("en", "wholesale", "debts").toLowerCase()).toContain("receivables");
  });

  it("retail remains unchanged", () => {
    expect(wholesaleTerm("en", "kiosk_duka", "sale").toLowerCase()).toContain("sale");
    expect(wholesaleTerm("en", "kiosk_duka", "stock").toLowerCase()).toContain("stock");
  });
});

describe("wholesale isolation — search aliases", () => {
  it("prioritizes wholesale bulk aliases", () => {
    const aliases = posSearchAliases("wholesale");
    expect(aliases.rice).toBeDefined();
    expect(aliases.sugar).toBeDefined();
    expect(aliases["soft drinks"]).toBeDefined();
    expect(aliases.detergent).toBeDefined();
  });

  it("excludes pharmacy aliases in wholesale", () => {
    const aliases = posSearchAliases("wholesale");
    expect(aliases.paracetamol).toBeUndefined();
    expect(aliases.amoxicillin).toBeUndefined();
    expect(aliases.omeprazole).toBeUndefined();
  });

  it("excludes hospitality aliases in wholesale", () => {
    const aliases = posSearchAliases("wholesale");
    expect(aliases.pilau).toBeUndefined();
    expect(aliases.chapati).toBeUndefined();
  });
});

describe("wholesale isolation — smart product guess", () => {
  it("guesses crate workflow for soft drinks", () => {
    const guess = inferProductGuess("soft drink crate", "wholesale");
    expect(guess.buyingUnit).toBe("crate");
    expect(guess.baseUnit).toBe("bottle");
  });

  it("guesses sack workflow for bulk grains", () => {
    const guess = inferProductGuess("Rice 50kg bag", "wholesale");
    expect(guess.baseUnit).toBe("kg");
    expect(guess.sellingMode).toBe("weighted");
  });
});

describe("wholesale isolation — starter pack", () => {
  it("contains wholesale-oriented items only", () => {
    const pack = starterPackForBusinessType("wholesale");
    const names = pack.map((line) => line.inferName.toLowerCase()).join(" ");
    expect(names).toContain("rice 25kg bag");
    expect(names).toContain("sugar 50kg sack");
    expect(names).toContain("soft drink crate");
    expect(names).toContain("water case");
    expect(names).not.toContain("paracetamol");
    expect(names).not.toContain("amoxicillin");
    expect(names).not.toContain("pilau");
  });

  it("keeps pharmacy and hospitality starter packs unchanged", () => {
    const pharmacy = starterPackForBusinessType("pharmacy").map((l) => l.inferName.toLowerCase()).join(" ");
    const restaurant = starterPackForBusinessType("restaurant").map((l) => l.inferName.toLowerCase()).join(" ");
    expect(pharmacy).toContain("paracetamol");
    expect(restaurant).toContain("pilau");
  });
});

describe("wholesale isolation — i18n contract", () => {
  it("has required wholesale keywords", () => {
    expect(t("en", "wholesaleTerm_invoice").toLowerCase()).toContain("invoice");
    expect(t("en", "wholesalePage_receivables").toLowerCase()).toContain("receivable");
    expect(t("en", "wholesaleTerm_warehouse").toLowerCase()).toContain("warehouse");
  });

  it("keeps forbidden cross-industry words out of wholesale labels", () => {
    const text = [
      t("en", "wholesalePage_warehouseTitle"),
      t("en", "wholesalePage_receivables"),
      t("en", "wholesaleTerm_createInvoice"),
    ]
      .join(" ")
      .toLowerCase();
    expect(text).not.toContain("dispense");
    expect(text).not.toContain("patient");
    expect(text).not.toContain("kitchen");
    expect(text).not.toContain("waiter");
  });
});
