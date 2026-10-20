/**
 * Hospitality menu sections — one canonical list in
 * `preferences.hospitalityMenuSections`.
 *
 * Products reference a section by ID (`product.menu.menuSection`). Renaming or
 * deactivating a section therefore never rewrites a product or a sale: the ID
 * and the section entry stay in place. Sections are never deleted, so legacy
 * references keep resolving to their label.
 */
import type { MenuSectionDef, Product, ShopPreferences } from "../types";
import { DEFAULT_MENU_SECTIONS } from "./menuModifiers";

export type MenuSectionErrorKey =
  | "menuSectionNameRequired"
  | "menuSectionNameDuplicate"
  | "menuSectionNotFound";

export type MenuSectionResult = {
  ok: boolean;
  sections: MenuSectionDef[];
  errorKey?: MenuSectionErrorKey;
  section?: MenuSectionDef;
};

export function resolveMenuSections(
  preferences: Pick<ShopPreferences, "hospitalityMenuSections">,
): MenuSectionDef[] {
  return preferences.hospitalityMenuSections
    ? preferences.hospitalityMenuSections
    : DEFAULT_MENU_SECTIONS.map((section) => ({ ...section }));
}

export function sortMenuSections(sections: readonly MenuSectionDef[]): MenuSectionDef[] {
  return [...sections].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
  );
}

export function isMenuSectionActive(section: Pick<MenuSectionDef, "isActive">): boolean {
  return section.isActive !== false;
}

export function activeMenuSections(sections: readonly MenuSectionDef[]): MenuSectionDef[] {
  return sortMenuSections(sections).filter((section) => isMenuSectionActive(section));
}

export function normalizeMenuSectionLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function nameKey(value: string): string {
  return normalizeMenuSectionLabel(value).toLocaleLowerCase();
}

export function addMenuSection(
  sections: readonly MenuSectionDef[],
  rawLabel: string,
): MenuSectionResult {
  const label = normalizeMenuSectionLabel(rawLabel);
  if (!label) return { ok: false, sections: [...sections], errorKey: "menuSectionNameRequired" };
  if (sections.some((section) => nameKey(section.label) === nameKey(label))) {
    return { ok: false, sections: [...sections], errorKey: "menuSectionNameDuplicate" };
  }
  const existingIds = new Set(sections.map((section) => section.id));
  let id = `menu-section-${crypto.randomUUID().slice(0, 8)}`;
  while (existingIds.has(id)) id = `menu-section-${crypto.randomUUID().slice(0, 8)}`;
  const sortOrder = sections.reduce((max, section) => Math.max(max, section.sortOrder || 0), -1) + 1;
  const section: MenuSectionDef = { id, label, sortOrder, isActive: true };
  return { ok: true, sections: [...sections, section], section };
}

/** Rename in place: the ID, order and active state are preserved. */
export function renameMenuSection(
  sections: readonly MenuSectionDef[],
  id: string,
  rawLabel: string,
): MenuSectionResult {
  if (!sections.some((section) => section.id === id)) {
    return { ok: false, sections: [...sections], errorKey: "menuSectionNotFound" };
  }
  const label = normalizeMenuSectionLabel(rawLabel);
  if (!label) return { ok: false, sections: [...sections], errorKey: "menuSectionNameRequired" };
  if (sections.some((section) => section.id !== id && nameKey(section.label) === nameKey(label))) {
    return { ok: false, sections: [...sections], errorKey: "menuSectionNameDuplicate" };
  }
  return {
    ok: true,
    sections: sections.map((section) => (section.id === id ? { ...section, label } : section)),
  };
}

/** Deactivation is presentation-only: the section record and its ID stay. */
export function setMenuSectionActive(
  sections: readonly MenuSectionDef[],
  id: string,
  isActive: boolean,
): MenuSectionDef[] {
  return sections.map((section) => (section.id === id ? { ...section, isActive } : section));
}

/**
 * Restore the default sections without deleting custom ones. Default IDs are
 * re-added/reactivated with their default labels; custom sections keep their
 * IDs, labels and active state so existing products never lose their section.
 */
export function restoreDefaultMenuSections(
  sections: readonly MenuSectionDef[],
): MenuSectionDef[] {
  const defaultIds = new Set<string>(DEFAULT_MENU_SECTIONS.map((section) => section.id));
  const custom = sections.filter((section) => !defaultIds.has(section.id));
  return sortMenuSections([
    ...DEFAULT_MENU_SECTIONS.map((section) => ({ ...section, isActive: true })),
    ...custom,
  ]);
}

export function validateMenuSectionNames(
  sections: readonly MenuSectionDef[],
): MenuSectionErrorKey | null {
  const seen = new Set<string>();
  for (const section of sections) {
    const key = nameKey(section.label);
    if (!key) return "menuSectionNameRequired";
    if (seen.has(key)) return "menuSectionNameDuplicate";
    seen.add(key);
  }
  return null;
}

export function menuSectionLabel(
  sections: readonly MenuSectionDef[],
  id: string | null | undefined,
  fallback: string,
): string {
  if (!id) return fallback;
  return sections.find((section) => section.id === id)?.label ?? fallback;
}

/** Product section IDs that no longer exist in the configured list. */
export function legacyMenuSectionIds(
  products: readonly Product[],
  sections: readonly MenuSectionDef[],
): string[] {
  const known = new Set(sections.map((section) => section.id));
  const out = new Set<string>();
  for (const product of products) {
    const id = product.menu?.menuSection;
    if (id && !known.has(id)) out.add(id);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

export type MenuSectionOption = {
  id: string;
  label: string;
  isActive: boolean;
  /** The product points at an ID that is not in the configured list. */
  isLegacy: boolean;
};

/**
 * Options for the product section picker. Inactive and legacy current values
 * are included so editing an existing dish never silently clears its section.
 */
export function menuSectionOptions(
  sections: readonly MenuSectionDef[],
  currentId: string | null | undefined,
): MenuSectionOption[] {
  const sorted = sortMenuSections(sections);
  const options: MenuSectionOption[] = sorted.map((section) => ({
    id: section.id,
    label: section.label,
    isActive: isMenuSectionActive(section),
    isLegacy: false,
  }));
  if (currentId && !sorted.some((section) => section.id === currentId)) {
    options.push({ id: currentId, label: currentId, isActive: true, isLegacy: true });
  }
  return options;
}

/**
 * A product is printable when its section is active, has no section, or points
 * at a legacy ID (we cannot know it was deactivated, so preserve it).
 */
export function isProductInPrintableMenuSection(
  product: Product,
  sections: readonly MenuSectionDef[],
): boolean {
  const id = product.menu?.menuSection;
  if (!id) return true;
  const section = sections.find((candidate) => candidate.id === id);
  return !section || isMenuSectionActive(section);
}

/**
 * Deactivated sections are omitted from the customer-facing printed menu when
 * printing "all". An explicit section filter still prints that section, so the
 * owner can review or reprint it before reactivating.
 */
export function filterProductsForPrintedMenu(
  products: readonly Product[],
  sections: readonly MenuSectionDef[],
  activeSectionId: string | null | undefined,
): Product[] {
  if (activeSectionId) return [...products];
  return products.filter((product) => isProductInPrintableMenuSection(product, sections));
}
