import { scopedStorageKey as accountScopedStorageKey } from "../offline/accountScope";
import { getPersistenceNamespace } from "../offline/shopScope";
import type { PackKind, SellUnitKind } from "./simpleProductWizard";
import type { PharmacyProductWizardStep, RetailProductWizardStep } from "./productWizardSteps";

const BASE_KEY = "product_wizard_session_v1";
const VERSION = 1 as const;

export type RetailWizardSessionFields = {
  step: RetailProductWizardStep;
  name: string;
  shelf: string;
  sellUnit: SellUnitKind;
  sellUnitCustom: string;
  hasPack: boolean;
  packKind: PackKind;
  packCustom: string;
  piecesPerPack: string;
  stockCount: string;
  sellPrice: string;
  buyPackPrice: string;
  auditReason: string;
  editingProductId: string | null;
};

export type PharmacyWizardSessionFields = {
  step: PharmacyProductWizardStep;
  name: string;
  category: string;
  strength: string;
  medicineForm: string;
  expiryDate: string;
  minAlert: string;
  packagingEnabled: boolean;
  baseUnit: string;
  level1Enabled: boolean;
  level1Unit: string;
  level1Qty: string;
  level2Enabled: boolean;
  level2Unit: string;
  level2Qty: string;
  receivedOuterQty: string;
  openingStock: string;
  totalAmountPaid: string;
  sellTablet: boolean;
  sellStrip: boolean;
  sellBox: boolean;
  tabletPrice: string;
  stripPrice: string;
  boxPrice: string;
  masterState: Record<string, unknown>;
  batchNumber: string;
  manufactureDate: string;
};

export type ProductWizardSessionDraft =
  | { v: typeof VERSION; kind: "retail"; fields: RetailWizardSessionFields }
  | { v: typeof VERSION; kind: "pharmacy"; fields: PharmacyWizardSessionFields };

function storageKey(): string | null {
  const ns = getPersistenceNamespace();
  if (!ns) return null;
  return accountScopedStorageKey(BASE_KEY, ns);
}

function parseDraft(raw: string | null): ProductWizardSessionDraft | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ProductWizardSessionDraft;
    if (parsed?.v !== VERSION) return null;
    if (parsed.kind !== "retail" && parsed.kind !== "pharmacy") return null;
    if (!parsed.fields || typeof parsed.fields !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readProductWizardSessionDraft(): ProductWizardSessionDraft | null {
  if (typeof sessionStorage === "undefined") return null;
  const key = storageKey();
  if (!key) return null;
  try {
    return parseDraft(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeProductWizardSessionDraft(draft: ProductWizardSessionDraft): void {
  if (typeof sessionStorage === "undefined") return;
  const key = storageKey();
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* quota / private mode */
  }
}

export function clearProductWizardSessionDraft(): void {
  if (typeof sessionStorage === "undefined") return;
  const key = storageKey();
  if (!key) return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** After Save & add another: reset product fields, keep the shelf/folder identity. */
export function retailWizardAfterSaveAndAddAnother(
  fields: RetailWizardSessionFields,
): RetailWizardSessionFields {
  return {
    step: "name",
    name: "",
    shelf: fields.shelf,
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
  };
}

export function isRetailWizardDirty(fields: RetailWizardSessionFields): boolean {
  return (
    fields.step !== "name" ||
    fields.name.trim().length > 0 ||
    fields.shelf.trim().length > 0 ||
    fields.sellUnit !== "piece" ||
    fields.sellUnitCustom.trim().length > 0 ||
    fields.hasPack ||
    fields.packCustom.trim().length > 0 ||
    fields.piecesPerPack.trim().length > 0 ||
    fields.stockCount.trim().length > 0 ||
    fields.sellPrice.trim().length > 0 ||
    fields.buyPackPrice.trim().length > 0 ||
    fields.auditReason.trim().length > 0 ||
    Boolean(fields.editingProductId)
  );
}

export function isPharmacyWizardDirty(fields: PharmacyWizardSessionFields): boolean {
  const m = fields.masterState;
  return (
    fields.step !== "details" ||
    fields.name.trim().length > 0 ||
    fields.category.trim().length > 0 ||
    fields.strength.trim().length > 0 ||
    fields.medicineForm.trim().length > 0 ||
    fields.expiryDate.trim().length > 0 ||
    fields.minAlert.trim() !== "10" ||
    fields.packagingEnabled ||
    fields.level1Enabled ||
    fields.level2Enabled ||
    fields.receivedOuterQty.trim().length > 0 ||
    fields.openingStock.trim().length > 0 ||
    fields.totalAmountPaid.trim().length > 0 ||
    fields.sellStrip ||
    fields.sellBox ||
    fields.tabletPrice.trim().length > 0 ||
    fields.stripPrice.trim().length > 0 ||
    fields.boxPrice.trim().length > 0 ||
    fields.batchNumber.trim().length > 0 ||
    fields.manufactureDate.trim().length > 0 ||
    Boolean(
      (typeof m?.brandName === "string" && m.brandName.trim().length > 0) ||
        (typeof m?.genericName === "string" && m.genericName.trim().length > 0) ||
        (typeof m?.primaryBarcode === "string" && m.primaryBarcode.trim().length > 0),
    )
  );
}
