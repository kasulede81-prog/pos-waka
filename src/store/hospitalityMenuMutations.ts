/**
 * Phase 6.6 — hospitality menu order mutations.
 */

import type {
  HospitalityCourse,
  Product,
  SaleLine,
  SaleLineComboSelection,
  SaleLineModifier,
} from "../types";
import { mergeDraftSaleLine, shouldMergeDraftSaleLines } from "../lib/draftCart";
import { buildComboSaleLine, normalizeComboConfig } from "../lib/comboMeals";
import {
  buildConfiguredSaleLine,
  productHasOrderConfig,
  saleLineMergeKey,
} from "../lib/menuModifiers";
import {
  checkIngredientAvailability,
  requirementsFromSaleLines,
  shouldDeductFinishedProductStock,
} from "../lib/recipeEngine";
import {
  effectiveIngredientPolicy,
  resolveIngredientPolicyConfig,
} from "../lib/hospitalityHardware";
import type { PosState } from "./usePosStore";

type StoreGet = () => PosState;
type StoreSet = (partial: Partial<PosState> | ((s: PosState) => Partial<PosState>)) => void;

type Deps = {
  get: StoreGet;
  set: StoreSet;
  denyUnlessEffectivePermission: (
    permission: import("../types").Permission,
    action: string,
  ) => { ok: false; errorKey: string } | null;
  scheduleDraftPersist: (get: StoreGet) => void;
};

export function createHospitalityMenuStoreActions(deps: Deps) {
  const { get, set, denyUnlessEffectivePermission, scheduleDraftPersist } = deps;

  return {
    addHospitalityDraftLine: (input: {
      product: Product;
      quantity?: number;
      variantId?: string | null;
      modifiers?: SaleLineModifier[];
      comboSelections?: SaleLineComboSelection[];
      notes?: string | null;
      course?: HospitalityCourse | null;
      seatNumber?: number | null;
      managerOverride?: boolean;
    }) => {
      const denied = denyUnlessEffectivePermission("hospitality.order", "addHospitalityDraftLine");
      if (denied) return { ok: false as const, errorKey: denied.errorKey };

      const state = get();
      const isCombo = Boolean(normalizeComboConfig(input.product.menu?.combo));

      let built: { line: SaleLine | null; errorKey?: string };
      if (isCombo) {
        built = buildComboSaleLine({
          comboProduct: input.product,
          selections: input.comboSelections ?? [],
          products: state.products,
          quantity: input.quantity,
          notes: input.notes,
        });
      } else {
        built = buildConfiguredSaleLine({
          product: input.product,
          quantity: input.quantity,
          variantId: input.variantId,
          modifiers: input.modifiers,
          comboSelections: input.comboSelections,
          notes: input.notes,
          course: input.course,
          seatNumber: input.seatNumber,
          isComboMeal: isCombo,
        });
      }
      if (!built.line) return { ok: false as const, errorKey: built.errorKey ?? "invalid" };

      const line = built.line;
      const ingPolicy = resolveIngredientPolicyConfig(state.preferences);
      const policy = effectiveIngredientPolicy(state.preferences);
      const trialLines = [...state.draftLines, line];
      const requirements = requirementsFromSaleLines(trialLines, state.products);
      const shortages = ingPolicy.allowNegativeInventory
        ? []
        : checkIngredientAvailability(requirements, state.products);

      if (shortages.length > 0 && !input.managerOverride) {
        if (policy === "block") return { ok: false as const, errorKey: "ingredientShortage", shortages };
        if (policy === "manager_override") {
          return { ok: false as const, errorKey: "ingredientShortageOverride", shortages };
        }
      }

      if (shouldDeductFinishedProductStock(input.product)) {
        const existingQty =
          state.draftLines.find((l) => saleLineMergeKey(l) === saleLineMergeKey(line))?.quantity ?? 0;
        const nextQty = existingQty + line.quantity;
        if (nextQty > input.product.stockOnHand + 1e-6) {
          return { ok: false as const, errorKey: "noStock" };
        }
      }

      set((s) => {
        const existing = s.draftLines.find(
          (l) => l.productId === line.productId && shouldMergeDraftSaleLines(l, line),
        );
        if (existing && shouldMergeDraftSaleLines(existing, line)) {
          const merged = mergeDraftSaleLine(existing, line, input.product);
          return {
            draftLines: s.draftLines.map((l) => (l.id === existing.id ? merged : l)),
            draftInput: null,
          };
        }
        return { draftLines: [...s.draftLines, line], draftInput: null };
      });
      scheduleDraftPersist(get);
      return { ok: true as const, lineId: line.id };
    },

    setDraftLineNotesById: (lineId: string, notes: string | null) => {
      set((s) => ({
        draftLines: s.draftLines.map((l) =>
          (l.id ?? l.productId) === lineId
            ? { ...l, notes: notes?.trim() || null, updatedAt: new Date().toISOString() }
            : l,
        ),
      }));
      scheduleDraftPersist(get);
      return { ok: true as const };
    },

    setDraftLineCourseById: (lineId: string, course: HospitalityCourse | null) => {
      set((s) => ({
        draftLines: s.draftLines.map((l) =>
          (l.id ?? l.productId) === lineId ? { ...l, course, updatedAt: new Date().toISOString() } : l,
        ),
      }));
      scheduleDraftPersist(get);
      return { ok: true as const };
    },

    removeDraftLineById: (lineId: string) => {
      set((s) => ({
        draftLines: s.draftLines.filter((l) => (l.id ?? l.productId) !== lineId),
      }));
      scheduleDraftPersist(get);
    },

    adjustDraftLineQuantityById: (lineId: string, delta: number) => {
      const state = get();
      const line = state.draftLines.find((l) => (l.id ?? l.productId) === lineId);
      const product = line ? state.products.find((p) => p.id === line.productId) : undefined;
      if (!line || !product) return { ok: false as const, errorKey: "noSelection" };
      const nextQty = line.quantity + delta;
      if (nextQty <= 0) {
        set((s) => ({
          draftLines: s.draftLines.filter((l) => (l.id ?? l.productId) !== lineId),
        }));
        scheduleDraftPersist(get);
        return { ok: true as const };
      }
      if (shouldDeductFinishedProductStock(product) && nextQty > product.stockOnHand + 1e-6) {
        return { ok: false as const, errorKey: "noStock" };
      }
      const rebuilt = buildConfiguredSaleLine({
        product,
        quantity: nextQty,
        variantId: line.variantId,
        modifiers: line.selectedModifiers,
        comboSelections: line.comboSelections,
        notes: line.notes,
        course: line.course,
        seatNumber: line.seatNumber,
        isComboMeal: line.isComboMeal,
      });
      if (!rebuilt.line) return { ok: false as const, errorKey: "invalid" };
      const nextLine = { ...rebuilt.line, id: line.id };
      set((s) => ({
        draftLines: s.draftLines.map((l) => ((l.id ?? l.productId) === lineId ? nextLine : l)),
      }));
      scheduleDraftPersist(get);
      return { ok: true as const };
    },

    productNeedsOrderConfig: (product: Product) =>
      productHasOrderConfig(product) || Boolean(normalizeComboConfig(product.menu?.combo)),
  };
}
