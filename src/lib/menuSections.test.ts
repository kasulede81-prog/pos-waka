/**
 * Hospitality menu sections: stable IDs, safe rename/deactivate, legacy
 * references, printed-menu behavior, and the settings permission boundary.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { MenuSectionDef, Product, ShopPreferences } from "../types";
import {
  activeMenuSections,
  addMenuSection,
  filterProductsForPrintedMenu,
  isProductInPrintableMenuSection,
  legacyMenuSectionIds,
  menuSectionLabel,
  menuSectionOptions,
  renameMenuSection,
  resolveMenuSections,
  restoreDefaultMenuSections,
  setMenuSectionActive,
  sortMenuSections,
  validateMenuSectionNames,
} from "./menuSections";
import { DEFAULT_MENU_SECTIONS } from "./menuModifiers";
import { buildMenuDocument } from "./menuDocument";
import { authorizePreferencesPatch, requiredPermissionsForPreferencesPatch } from "./settingsAuthorization";
import type { SessionActor } from "./sessionActor";
import { usePosStore } from "../store/usePosStore";

const NOW = "2026-10-20T08:00:00.000Z";

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    sellingMode: "unit",
    baseUnit: "piece",
    sellingPricePerUnitUgx: 10_000,
    costPricePerUnitUgx: 3_000,
    stockOnHand: 10,
    minimumStockAlert: 0,
    category: "Food",
    sku: "",
    updatedAt: NOW,
    version: 1,
    ...partial,
  };
}

const customSections: MenuSectionDef[] = [
  { id: "food", label: "Food", sortOrder: 1, isActive: true },
  { id: "grill", label: "Grill", sortOrder: 9, isActive: true },
  { id: "old-specials", label: "Old specials", sortOrder: 10, isActive: false },
];

describe("section storage and defaults", () => {
  it("uses the saved list when present, otherwise the default sections", () => {
    expect(resolveMenuSections({})).toEqual(
      DEFAULT_MENU_SECTIONS.map((section) => ({ ...section })),
    );
    expect(resolveMenuSections({ hospitalityMenuSections: customSections })).toBe(customSections);
  });

  it("sorts by sortOrder and deactivation never removes the record", () => {
    const unsorted = [
      { id: "b", label: "B", sortOrder: 2 },
      { id: "a", label: "A", sortOrder: 1 },
    ];
    expect(sortMenuSections(unsorted).map((section) => section.id)).toEqual(["a", "b"]);

    const next = setMenuSectionActive(customSections, "grill", false);
    expect(next).toHaveLength(customSections.length);
    expect(next.find((section) => section.id === "grill")).toMatchObject({
      id: "grill",
      label: "Grill",
      sortOrder: 9,
      isActive: false,
    });
    expect(activeMenuSections(next).map((section) => section.id)).not.toContain("grill");
  });
});

describe("create and rename", () => {
  it("adds a custom section with a unique stable id and the next sort order", () => {
    const result = addMenuSection(customSections, "  Wood   fired  ");
    expect(result.ok).toBe(true);
    expect(result.section?.label).toBe("Wood fired");
    expect(result.section?.isActive).toBe(true);
    expect(result.section?.sortOrder).toBe(11);
    expect(result.section?.id).toMatch(/^menu-section-/);
    expect(customSections).toHaveLength(3); // input is never mutated
  });

  it("rejects empty and duplicate names", () => {
    expect(addMenuSection(customSections, "   ")).toMatchObject({
      ok: false,
      errorKey: "menuSectionNameRequired",
    });
    expect(addMenuSection(customSections, " grill ")).toMatchObject({
      ok: false,
      errorKey: "menuSectionNameDuplicate",
    });
  });

  it("renames without changing the id, order or active state", () => {
    const result = renameMenuSection(customSections, "grill", "  Charcoal Grill ");
    expect(result.ok).toBe(true);
    expect(result.sections.find((section) => section.id === "grill")).toMatchObject({
      id: "grill",
      label: "Charcoal Grill",
      sortOrder: 9,
      isActive: true,
    });
  });

  it("rejects empty/duplicate renames and unknown ids", () => {
    expect(renameMenuSection(customSections, "grill", "")).toMatchObject({
      ok: false,
      errorKey: "menuSectionNameRequired",
    });
    expect(renameMenuSection(customSections, "grill", "food")).toMatchObject({
      ok: false,
      errorKey: "menuSectionNameDuplicate",
    });
    expect(renameMenuSection(customSections, "missing", "New")).toMatchObject({
      ok: false,
      errorKey: "menuSectionNotFound",
    });
    expect(renameMenuSection(customSections, "grill", "GRILL").ok).toBe(true);
  });

  it("validates a draft before saving", () => {
    expect(validateMenuSectionNames(customSections)).toBeNull();
    expect(
      validateMenuSectionNames([{ id: "a", label: " ", sortOrder: 0 }]),
    ).toBe("menuSectionNameRequired");
    expect(
      validateMenuSectionNames([
        { id: "a", label: "Food", sortOrder: 0 },
        { id: "b", label: " food ", sortOrder: 1 },
      ]),
    ).toBe("menuSectionNameDuplicate");
  });
});

describe("restore defaults", () => {
  it("re-adds missing defaults without deleting custom sections or IDs", () => {
    const restored = restoreDefaultMenuSections(customSections);
    const ids = restored.map((section) => section.id);
    expect(ids).toContain("grill");
    expect(ids).toContain("old-specials");
    expect(ids).toContain("drinks");
    expect(new Set(ids).size).toBe(ids.length);
    expect(restored.find((section) => section.id === "old-specials")?.isActive).toBe(false);
    expect(restored.find((section) => section.id === "food")?.isActive).toBe(true);
  });

  it("reactivates a deactivated default section", () => {
    const deactivated = setMenuSectionActive(DEFAULT_MENU_SECTIONS, "food", false);
    const restored = restoreDefaultMenuSections(deactivated);
    expect(restored.find((section) => section.id === "food")?.isActive).toBe(true);
  });
});

describe("legacy references and product options", () => {
  const legacyProduct = product({
    id: "legacy",
    name: "Legacy dish",
    category: "Mains",
    menu: { menuSection: "mains" },
  });

  it("keeps unknown product section ids visible and filterable", () => {
    expect(legacyMenuSectionIds([legacyProduct], customSections)).toEqual(["mains"]);
    expect(isProductInPrintableMenuSection(legacyProduct, customSections)).toBe(true);
    expect(menuSectionLabel(customSections, "mains", "mains")).toBe("mains");
    expect(menuSectionLabel(customSections, "grill", "fallback")).toBe("Grill");
  });

  it("includes inactive and legacy current values in the product picker", () => {
    const options = menuSectionOptions(customSections, "mains");
    expect(options.map((option) => option.id)).toEqual(["food", "grill", "old-specials", "mains"]);
    expect(options.find((option) => option.id === "old-specials")?.isActive).toBe(false);
    expect(options.find((option) => option.id === "mains")).toMatchObject({
      isLegacy: true,
      label: "mains",
    });
  });
});

describe("printed menu behavior", () => {
  const active = product({
    id: "active",
    name: "Grilled chicken",
    category: "Food",
    menu: { menuSection: "grill" },
  });
  const inactive = product({
    id: "inactive",
    name: "Old special",
    category: "Specials",
    menu: { menuSection: "old-specials" },
  });
  const noSection = product({ id: "no-section", name: "Soda", category: "Drinks" });

  it("omits known inactive sections when printing all, but keeps legacy/no-section dishes", () => {
    const printed = filterProductsForPrintedMenu(
      [active, inactive, noSection, product({ id: "legacy", name: "Legacy", menu: { menuSection: "mains" } })],
      customSections,
      null,
    );
    expect(printed.map((p) => p.id)).toEqual(["active", "no-section", "legacy"]);
  });

  it("prints an explicitly selected inactive section", () => {
    const printed = filterProductsForPrintedMenu([active, inactive], customSections, "old-specials");
    expect(printed.map((p) => p.id)).toEqual(["active", "inactive"]);
  });

  it("does not mutate products or their retail category", () => {
    const snapshot = JSON.parse(JSON.stringify(inactive));
    filterProductsForPrintedMenu([inactive], customSections, null);
    expect(inactive).toEqual(snapshot);
    expect(inactive.category).toBe("Specials");
  });

  it("uses custom labels and the product category fallback in the export", () => {
    const doc = buildMenuDocument({
      lang: "en",
      preferences: { hospitalityMenuSections: customSections } as ShopPreferences,
      sections: customSections,
      menuProducts: [active, noSection],
      activeSectionLabel: "All",
      topDishes: [],
      topModifiers: [],
      lowMargin: [],
    });
    const body = doc.lines.join("\n");
    expect(body).toContain("Grill");
    expect(body).toContain("Grilled chicken");
    expect(body).toContain("Drinks");
    expect(body).toContain("Soda");
  });

  it("prints configured sections in sort order, with legacy/category groups last", () => {
    const doc = buildMenuDocument({
      lang: "en",
      preferences: { hospitalityMenuSections: customSections } as ShopPreferences,
      sections: customSections,
      // Deliberately reverse the input order; sortOrder must win.
      menuProducts: [noSection, active],
      activeSectionLabel: "All",
      topDishes: [],
      topModifiers: [],
      lowMargin: [],
    });
    expect(doc.lines.indexOf("Grill")).toBeLessThan(doc.lines.indexOf("Drinks"));
  });
});

describe("section management permission", () => {
  const patch = { hospitalityMenuSections: customSections };
  const owner: SessionActor = { userId: "local:owner", role: "owner", displayName: "Owner" };
  const cashier: SessionActor = { userId: "staff:c", role: "cashier", displayName: "Cashier" };
  const ctx = { snapshot: { kind: "local_full" } as const, authMode: "local" as const };

  it("requires settings.shop and denies a cashier at the store boundary", () => {
    expect(requiredPermissionsForPreferencesPatch(patch)).toEqual(["settings.shop"]);
    expect(authorizePreferencesPatch(cashier, patch, ctx).ok).toBe(false);
    expect(authorizePreferencesPatch(owner, patch, ctx).ok).toBe(true);
  });

  const baseline = usePosStore.getState().preferences;

  afterEach(() => {
    usePosStore.setState({ sessionActor: null, preferences: baseline });
  });

  it("does not persist section changes from a cashier through the store action", () => {
    usePosStore.setState({
      sessionActor: cashier,
      preferences: { ...baseline, hospitalityMenuSections: undefined },
    });
    usePosStore.getState().setPreferences({ hospitalityMenuSections: customSections });
    expect(usePosStore.getState().preferences.hospitalityMenuSections).toBeUndefined();

    usePosStore.setState({ sessionActor: owner });
    usePosStore.getState().setPreferences({ hospitalityMenuSections: customSections });
    expect(usePosStore.getState().preferences.hospitalityMenuSections).toEqual(customSections);
  });
});
