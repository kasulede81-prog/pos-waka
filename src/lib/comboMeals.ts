import type { ComboMealConfig, ComboSlot, Product, SaleLineComboSelection } from "../types";
import { buildConfiguredSaleLine } from "./menuModifiers";

export function normalizeComboConfig(combo?: ComboMealConfig | null): ComboMealConfig | null {
  if (!combo?.slots?.length) return null;
  return {
    comboPriceUgx: combo.comboPriceUgx ?? null,
    slots: combo.slots
      .map((s, i) => ({
        ...s,
        sortOrder: s.sortOrder ?? i,
        choices: (s.choices ?? []).filter((c) => Boolean(c.productId)),
      }))
      .filter((s) => s.choices.length > 0),
  };
}

export type ComboValidationResult =
  | { ok: true; selections: SaleLineComboSelection[] }
  | { ok: false; errorKey: string; slotId?: string };

export function validateComboSelections(
  combo: ComboMealConfig,
  selections: SaleLineComboSelection[],
  products: Product[],
): ComboValidationResult {
  const bySlot = new Map<string, SaleLineComboSelection[]>();
  for (const s of selections) {
    const list = bySlot.get(s.slotId) ?? [];
    list.push(s);
    bySlot.set(s.slotId, list);
  }

  const normalized: SaleLineComboSelection[] = [];
  for (const slot of combo.slots) {
    const picks = bySlot.get(slot.id) ?? [];
    const min = slot.required ? Math.max(1, slot.minChoices ?? 1) : Math.max(0, slot.minChoices ?? 0);
    const max = Math.max(min, slot.maxChoices ?? 1);
    if (picks.length < min) return { ok: false, errorKey: "comboSlotRequired", slotId: slot.id };
    if (picks.length > max) return { ok: false, errorKey: "comboSlotTooMany", slotId: slot.id };

    if (picks.length === 0 && !slot.required) continue;

    const choice = picks[0]!;
    const allowed = slot.choices.find((c) => c.productId === choice.productId);
    if (!allowed) return { ok: false, errorKey: "comboChoiceInvalid", slotId: slot.id };
    const product = products.find((p) => p.id === choice.productId);
    normalized.push({
      slotId: slot.id,
      slotLabel: slot.label,
      productId: choice.productId,
      productName: product?.name ?? choice.productName,
      priceDeltaUgx: Math.max(0, allowed.priceDeltaUgx ?? 0),
    });
  }
  return { ok: true, selections: normalized };
}

export function defaultComboSelections(combo: ComboMealConfig, products: Product[]): SaleLineComboSelection[] {
  const out: SaleLineComboSelection[] = [];
  for (const slot of combo.slots) {
    const defaultChoice = slot.choices.find((c) => c.isDefault) ?? slot.choices[0];
    if (!defaultChoice) continue;
    const product = products.find((p) => p.id === defaultChoice.productId);
    out.push({
      slotId: slot.id,
      slotLabel: slot.label,
      productId: defaultChoice.productId,
      productName: product?.name ?? "Item",
      priceDeltaUgx: Math.max(0, defaultChoice.priceDeltaUgx ?? 0),
    });
  }
  return out;
}

export function computeComboLinePriceUgx(
  comboProduct: Product,
  selections: SaleLineComboSelection[],
  componentProducts: Product[],
  quantity = 1,
): number {
  const combo = normalizeComboConfig(comboProduct.menu?.combo);
  if (!combo) return comboProduct.sellingPricePerUnitUgx * quantity;

  if (combo.comboPriceUgx != null && combo.comboPriceUgx >= 0) {
    const extras = selections.reduce((a, s) => a + s.priceDeltaUgx, 0);
    return Math.round((combo.comboPriceUgx + extras) * quantity);
  }

  let total = comboProduct.sellingPricePerUnitUgx;
  for (const sel of selections) {
    const comp = componentProducts.find((p) => p.id === sel.productId);
    if (comp) total += comp.sellingPricePerUnitUgx;
    total += sel.priceDeltaUgx;
  }
  return Math.round(total * quantity);
}

export function buildComboSaleLine(input: {
  comboProduct: Product;
  selections: SaleLineComboSelection[];
  products: Product[];
  quantity?: number;
  notes?: string | null;
}): { line: import("../types").SaleLine | null; errorKey?: string } {
  const combo = normalizeComboConfig(input.comboProduct.menu?.combo);
  if (!combo) return { line: null, errorKey: "invalid" };

  const validated = validateComboSelections(combo, input.selections, input.products);
  if (!validated.ok) return { line: null, errorKey: validated.errorKey };

  const qty = Math.max(1, Math.floor(input.quantity ?? 1));
  const priceUgx = computeComboLinePriceUgx(
    input.comboProduct,
    validated.selections,
    input.products,
    qty,
  );

  const tempProduct: Product = {
    ...input.comboProduct,
    sellingPricePerUnitUgx: Math.round(priceUgx / qty),
  };

  return buildConfiguredSaleLine({
    product: tempProduct,
    quantity: qty,
    comboSelections: validated.selections,
    notes: input.notes,
    isComboMeal: true,
    productsById: new Map(input.products.map((p) => [p.id, p])),
  });
}

export function comboSlotLabels(slot: ComboSlot): string {
  return slot.label;
}
