import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setActiveAccountKey } from "../offline/accountScope";
import {
  clearProductWizardSessionDraft,
  isPharmacyWizardDirty,
  isRetailWizardDirty,
  readProductWizardSessionDraft,
  writeProductWizardSessionDraft,
  type PharmacyWizardSessionFields,
  type RetailWizardSessionFields,
} from "./productWizardSessionDraft";

const ACCOUNT = "sb:wizard-draft-user";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function emptyRetail(overrides: Partial<RetailWizardSessionFields> = {}): RetailWizardSessionFields {
  return {
    step: "name",
    name: "",
    shelf: "",
    sellUnit: "piece",
    sellUnitCustom: "",
    hasPack: false,
    packKind: "crate",
    packCustom: "",
    piecesPerPack: "",
    stockCount: "",
    sellPrice: "",
    buyPackPrice: "",
    auditReason: "",
    editingProductId: null,
    ...overrides,
  };
}

function emptyPharmacy(overrides: Partial<PharmacyWizardSessionFields> = {}): PharmacyWizardSessionFields {
  return {
    step: "details",
    name: "",
    category: "",
    strength: "",
    medicineForm: "",
    expiryDate: "",
    minAlert: "10",
    packagingEnabled: false,
    baseUnit: "tablet",
    level1Enabled: false,
    level1Unit: "strip",
    level1Qty: "",
    level2Enabled: false,
    level2Unit: "box",
    level2Qty: "",
    receivedOuterQty: "",
    openingStock: "",
    totalAmountPaid: "",
    sellTablet: true,
    sellStrip: false,
    sellBox: false,
    tabletPrice: "",
    stripPrice: "",
    boxPrice: "",
    masterState: {},
    batchNumber: "",
    manufactureDate: "",
    ...overrides,
  };
}

describe("productWizardSessionDraft", () => {
  beforeEach(() => {
    setActiveAccountKey(ACCOUNT);
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    setActiveAccountKey(null);
  });

  it("returns null when nothing is stored", () => {
    expect(readProductWizardSessionDraft()).toBeNull();
  });

  it("round-trips a retail draft for the active account", () => {
    writeProductWizardSessionDraft({
      v: 1,
      kind: "retail",
      fields: emptyRetail({ name: "Soap", sellPrice: "1000" }),
    });
    const draft = readProductWizardSessionDraft();
    expect(draft?.kind).toBe("retail");
    if (draft?.kind !== "retail") return;
    expect(draft.fields.name).toBe("Soap");
    expect(draft.fields.sellPrice).toBe("1000");
  });

  it("does not leak a draft to another account", () => {
    writeProductWizardSessionDraft({
      v: 1,
      kind: "retail",
      fields: emptyRetail({ name: "Soap" }),
    });
    setActiveAccountKey("sb:other-user");
    expect(readProductWizardSessionDraft()).toBeNull();
  });

  it("skips writes when no account is active", () => {
    setActiveAccountKey(null);
    writeProductWizardSessionDraft({
      v: 1,
      kind: "retail",
      fields: emptyRetail({ name: "Soap" }),
    });
    setActiveAccountKey(ACCOUNT);
    expect(readProductWizardSessionDraft()).toBeNull();
  });

  it("clear removes the stored draft", () => {
    writeProductWizardSessionDraft({
      v: 1,
      kind: "pharmacy",
      fields: emptyPharmacy({ name: "Amoxil" }),
    });
    clearProductWizardSessionDraft();
    expect(readProductWizardSessionDraft()).toBeNull();
  });

  it("treats a blank retail create form as clean", () => {
    expect(isRetailWizardDirty(emptyRetail())).toBe(false);
  });

  it("treats typed retail fields or a later step as dirty", () => {
    expect(isRetailWizardDirty(emptyRetail({ name: "Soap" }))).toBe(true);
    expect(isRetailWizardDirty(emptyRetail({ step: "shelf" }))).toBe(true);
  });

  it("treats a blank pharmacy create form as clean", () => {
    expect(isPharmacyWizardDirty(emptyPharmacy())).toBe(false);
  });
});

describe("PRODUCT-CREATE-FLOW-1.1 wiring", () => {
  it("does not reset SimpleAddProductWizard when shelves identity changes", () => {
    const src = readFileSync(join(ROOT, "src/components/stock/SimpleAddProductWizard.tsx"), "utf8");
    expect(src).not.toMatch(/\[open, prefill, initialStep, shelves\]/);
  });

  it("asks before discarding the product wizard", () => {
    const src = readFileSync(join(ROOT, "src/components/stock/wizard/ProductWizardShell.tsx"), "utf8");
    expect(src).toContain("productEditorDiscardConfirm");
    expect(src).toContain("dirty");
  });
});
