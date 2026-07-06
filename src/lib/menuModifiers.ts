import type {
  ModifierGroup,
  ModifierOption,
  Product,
  ProductMenuConfig,
  ProductVariant,
  SaleLine,
  SaleLineComboSelection,
  SaleLineModifier,
} from "../types";
import { buildSaleLine } from "./sellingEngine";
import { resolvePackCostUnitsDepleted } from "./costPrecision";
import { resolveProductDefaultCourse, resolveProductPrepTimeMinutes } from "./productHospitalityRouting";

export const DEFAULT_MENU_SECTIONS = [
  { id: "drinks", label: "Drinks", sortOrder: 0 },
  { id: "food", label: "Food", sortOrder: 1 },
  { id: "breakfast", label: "Breakfast", sortOrder: 2 },
  { id: "lunch", label: "Lunch", sortOrder: 3 },
  { id: "dinner", label: "Dinner", sortOrder: 4 },
  { id: "dessert", label: "Dessert", sortOrder: 5 },
  { id: "kids", label: "Kids", sortOrder: 6 },
  { id: "seasonal", label: "Seasonal", sortOrder: 7 },
  { id: "specials", label: "Specials", sortOrder: 8 },
] as const;

export function normalizeProductMenu(menu?: ProductMenuConfig | null): ProductMenuConfig | null {
  if (!menu) return null;
  const groups = (menu.modifierGroups ?? [])
    .map((g, gi) => ({
      ...g,
      sortOrder: g.sortOrder ?? gi,
      options: (g.options ?? [])
        .filter((o) => o.isActive !== false)
        .map((o, oi) => ({ ...o, sortOrder: o.sortOrder ?? oi, isActive: o.isActive !== false })),
    }))
    .filter((g) => g.options.length > 0);
  const variants = (menu.variants ?? [])
    .filter((v) => v.isActive !== false)
    .map((v, vi) => ({ ...v, sortOrder: v.sortOrder ?? vi, isActive: v.isActive !== false }));
  return {
    productKind: menu.productKind ?? "finished_menu",
    modifierGroups: groups,
    variants,
    combo: menu.combo ?? null,
    recipe: menu.recipe ?? null,
    menuSection: menu.menuSection ?? null,
    menuSortOrder: menu.menuSortOrder ?? 0,
    hideFromMenu: menu.hideFromMenu === true,
  };
}

export function productMenuConfig(product: Product): ProductMenuConfig | null {
  return normalizeProductMenu(product.menu);
}

export function productHasOrderConfig(product: Product): boolean {
  const menu = productMenuConfig(product);
  if (!menu) return false;
  return (
    (menu.modifierGroups?.length ?? 0) > 0 ||
    (menu.variants?.length ?? 0) > 0 ||
    (menu.combo?.slots?.length ?? 0) > 0
  );
}

export function resolveProductVariant(product: Product, variantId?: string | null): ProductVariant | null {
  const variants = productMenuConfig(product)?.variants ?? [];
  if (!variants.length) return null;
  if (variantId) {
    const found = variants.find((v) => v.id === variantId);
    if (found) return found;
  }
  return variants.find((v) => v.isDefault) ?? variants[0] ?? null;
}

export function defaultModifierSelections(groups: ModifierGroup[]): SaleLineModifier[] {
  const out: SaleLineModifier[] = [];
  for (const group of groups) {
    const defaults = group.options.filter((o) => o.isDefault);
    const picks =
      defaults.length > 0
        ? defaults
        : group.required && group.selectionMode === "single"
          ? group.options.slice(0, 1)
          : [];
    for (const opt of picks) {
      out.push(modifierToSaleLine(group, opt));
    }
  }
  return out;
}

export function modifierToSaleLine(group: ModifierGroup, option: ModifierOption): SaleLineModifier {
  return {
    groupId: group.id,
    groupLabel: group.label,
    optionId: option.id,
    optionLabel: option.label,
    priceDeltaUgx: Math.max(0, Math.floor(option.priceDeltaUgx ?? 0)),
    kitchenNote: option.kitchenNote ?? null,
  };
}

export type ModifierValidationResult =
  | { ok: true; modifiers: SaleLineModifier[] }
  | { ok: false; errorKey: string; groupId?: string };

export function validateModifierSelections(
  groups: ModifierGroup[],
  selected: SaleLineModifier[],
): ModifierValidationResult {
  const byGroup = new Map<string, SaleLineModifier[]>();
  for (const m of selected) {
    const list = byGroup.get(m.groupId) ?? [];
    list.push(m);
    byGroup.set(m.groupId, list);
  }

  const normalized: SaleLineModifier[] = [];
  for (const group of groups) {
    const picks = byGroup.get(group.id) ?? [];
    const count = picks.length;
    const min = group.required ? Math.max(1, group.minSelections ?? 1) : Math.max(0, group.minSelections ?? 0);
    const max =
      group.selectionMode === "single"
        ? 1
        : Math.max(min, group.maxSelections ?? group.options.length);

    if (count < min) return { ok: false, errorKey: "modifierRequired", groupId: group.id };
    if (count > max) return { ok: false, errorKey: "modifierTooMany", groupId: group.id };

    for (const pick of picks) {
      const opt = group.options.find((o) => o.id === pick.optionId);
      if (!opt) return { ok: false, errorKey: "modifierInvalid", groupId: group.id };
      normalized.push(modifierToSaleLine(group, opt));
    }
  }
  return { ok: true, modifiers: normalized };
}

export function modifierPriceTotal(modifiers: SaleLineModifier[]): number {
  return modifiers.reduce((a, m) => a + Math.max(0, m.priceDeltaUgx), 0);
}

export function buildSaleLineConfigFingerprint(input: {
  productId: string;
  variantId?: string | null;
  modifiers?: SaleLineModifier[];
  comboSelections?: SaleLineComboSelection[];
}): string {
  const modKey = (input.modifiers ?? [])
    .map((m) => `${m.groupId}:${m.optionId}`)
    .sort()
    .join("|");
  const comboKey = (input.comboSelections ?? [])
    .map((c) => `${c.slotId}:${c.productId}`)
    .sort()
    .join("|");
  return [input.productId, input.variantId ?? "", modKey, comboKey].join("::");
}

export function formatModifierLabels(modifiers: SaleLineModifier[]): string[] {
  return modifiers.map((m) => (m.priceDeltaUgx > 0 ? `${m.optionLabel} (+${m.priceDeltaUgx})` : m.optionLabel));
}

export function formatKitchenNotesFromLine(line: SaleLine): string | null {
  const parts: string[] = [];
  if (line.variantLabel) parts.push(line.variantLabel);
  for (const m of line.selectedModifiers ?? []) {
    parts.push(m.kitchenNote?.trim() || m.optionLabel);
  }
  for (const c of line.comboSelections ?? []) {
    parts.push(`${c.slotLabel}: ${c.productName}`);
  }
  if (line.notes?.trim()) parts.push(line.notes.trim());
  return parts.length ? parts.join(" · ") : null;
}

export function buildConfiguredSaleLine(input: {
  product: Product;
  quantity?: number;
  variantId?: string | null;
  modifiers?: SaleLineModifier[];
  comboSelections?: SaleLineComboSelection[];
  notes?: string | null;
  course?: import("../types").HospitalityCourse | null;
  seatNumber?: number | null;
  isComboMeal?: boolean;
  productsById?: Map<string, Product>;
}): { line: SaleLine | null; errorKey?: string } {
  const menu = productMenuConfig(input.product);
  const qty = Math.max(1, Math.floor(input.quantity ?? 1));
  const variant = resolveProductVariant(input.product, input.variantId);
  const groups = menu?.modifierGroups ?? [];

  let modifiers = input.modifiers ?? [];
  if (groups.length > 0 && modifiers.length === 0) {
    modifiers = defaultModifierSelections(groups);
  }
  if (groups.length > 0) {
    const validated = validateModifierSelections(groups, modifiers);
    if (!validated.ok) return { line: null, errorKey: validated.errorKey };
    modifiers = validated.modifiers;
  }

  const basePrice = variant?.priceUgx ?? input.product.sellingPricePerUnitUgx;
  const perItemMod = modifierPriceTotal(modifiers);
  const perItemCombo = (input.comboSelections ?? []).reduce((a, c) => a + Math.max(0, c.priceDeltaUgx), 0);
  const lineTotalUgx = Math.round((basePrice + perItemMod) * qty + perItemCombo * (input.isComboMeal ? 1 : qty));
  const unitPrice = qty > 0 ? Math.round(lineTotalUgx / qty) : basePrice;

  const productForLine: Product = {
    ...input.product,
    sellingPricePerUnitUgx: unitPrice,
    costPricePerUnitUgx: variant?.costPriceUgx ?? input.product.costPricePerUnitUgx,
    hospitality: {
      ...input.product.hospitality,
      prepTimeMinutes: variant?.prepTimeMinutes ?? input.product.hospitality?.prepTimeMinutes,
    },
  };

  const built = buildSaleLine(productForLine, "quantity", qty, {
    packSlotStart: resolvePackCostUnitsDepleted(productForLine),
  });
  if (!built.line) return { line: null, errorKey: built.error ?? "invalid" };

  const fingerprint = buildSaleLineConfigFingerprint({
    productId: input.product.id,
    variantId: variant?.id ?? null,
    modifiers,
    comboSelections: input.comboSelections,
  });

  let displayName = input.product.name;
  if (variant) displayName = `${displayName} (${variant.label})`;
  if (input.isComboMeal) displayName = `${displayName} [Combo]`;

  const line: SaleLine = {
    ...built.line,
    id: crypto.randomUUID(),
    name: displayName,
    updatedAt: new Date().toISOString(),
    originalLineTotalUgx: built.line.lineTotalUgx,
    variantId: variant?.id ?? null,
    variantLabel: variant?.label ?? null,
    selectedModifiers: modifiers.length ? modifiers : undefined,
    comboSelections: input.comboSelections?.length ? input.comboSelections : undefined,
    configFingerprint: fingerprint,
    notes: input.notes?.trim() || null,
    course: input.course ?? resolveProductDefaultCourse(input.product),
    seatNumber: input.seatNumber ?? null,
    isComboMeal: input.isComboMeal === true,
    stockVersionAtAdd: input.product.version ?? 1,
    unitPriceUgx: unitPrice,
    lineTotalUgx,
    estimatedProfitUgx: Math.round(lineTotalUgx - qty * productForLine.costPricePerUnitUgx),
  };

  return { line };
}

export function saleLineMergeKey(line: SaleLine): string {
  return line.configFingerprint ?? line.productId;
}

export function resolveLinePrepTimeMinutes(product: Product, line: SaleLine): number | null {
  const variant = line.variantId ? resolveProductVariant(product, line.variantId) : null;
  return variant?.prepTimeMinutes ?? resolveProductPrepTimeMinutes(product);
}
