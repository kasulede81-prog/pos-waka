import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DesktopCategoryRail } from "../components/pos/desktop/DesktopCategoryRail";
import { CATEGORY_FILTER_ALL } from "./productCategories";
import {
  desktopCategoryRailModel,
  desktopCategoryShelvesForDisplay,
  isSellHierarchyCatalogNav,
  sortDesktopCategoryShelvesAz,
} from "./desktopCategoryNav";
import type { PosShelfCard } from "./posShelfOrder";

function card(key: string, label = key, count = 0): PosShelfCard {
  return { key, label, count, icon: null };
}

describe("desktopCategoryNav H2c rail", () => {
  const legacy = [card("DELL"), card("HP"), card("LENOVO"), card("Accessories", "Accessories")];

  it("flag OFF keeps A–Z and All, never Back, and ignores hierarchy cards", () => {
    const model = desktopCategoryRailModel({
      hierarchyEnabled: false,
      atRoot: true,
      sellCategoryKey: "HP",
      hierarchyFolderCards: [card("ELECTRONICS")],
      legacyShelfCards: legacy,
    });
    expect(model.preserveOrder).toBe(false);
    expect(model.showAll).toBe(true);
    expect(model.showBack).toBe(false);
    expect(model.selectedKey).toBe("HP");
    expect(model.shelves.map((s) => s.key)).toEqual(["DELL", "HP", "LENOVO", "Accessories"]);
    expect(sortDesktopCategoryShelvesAz(legacy).map((s) => s.key)).toEqual([
      "Accessories",
      "DELL",
      "HP",
      "LENOVO",
    ]);
    expect(desktopCategoryShelvesForDisplay(legacy, false).map((s) => s.key)).toEqual([
      "Accessories",
      "DELL",
      "HP",
      "LENOVO",
    ]);
  });

  it("flag ON root shows resolver children in given order, All selected, no Back", () => {
    const roots = [card("ELECTRONICS", "Electronics"), card("ACCESSORIES", "Accessories"), card("PRINTERS")];
    const model = desktopCategoryRailModel({
      hierarchyEnabled: true,
      atRoot: true,
      sellCategoryKey: "DELL",
      hierarchyFolderCards: roots,
      legacyShelfCards: legacy,
    });
    expect(model.preserveOrder).toBe(true);
    expect(model.showAll).toBe(true);
    expect(model.showBack).toBe(false);
    expect(model.selectedKey).toBe(CATEGORY_FILTER_ALL);
    expect(model.shelves.map((s) => s.key)).toEqual(["ELECTRONICS", "ACCESSORIES", "PRINTERS"]);
    expect(desktopCategoryShelvesForDisplay(roots, true).map((s) => s.key)).toEqual([
      "ELECTRONICS",
      "ACCESSORIES",
      "PRINTERS",
    ]);
  });

  it("flag ON nested shows current-level children only, Back, and no All", () => {
    const children = [card("LAPTOPS", "Laptops"), card("DESKTOPS", "Desktops"), card("WORKSTATIONS")];
    const model = desktopCategoryRailModel({
      hierarchyEnabled: true,
      atRoot: false,
      sellCategoryKey: "COMPUTERS",
      hierarchyFolderCards: children,
      legacyShelfCards: legacy,
    });
    expect(model.showAll).toBe(false);
    expect(model.showBack).toBe(true);
    expect(model.selectedKey).toBe("");
    expect(model.shelves.map((s) => s.key)).toEqual(["LAPTOPS", "DESKTOPS", "WORKSTATIONS"]);
    expect(model.shelves.map((s) => s.key)).not.toContain("ELECTRONICS");
    expect(model.shelves.map((s) => s.key)).not.toContain("COMPUTERS");
  });

  it("desktop catalog nav is on for Electron/web desktop and mobile, off while searching or on compact", () => {
    expect(
      isSellHierarchyCatalogNav({
        catalogHierarchyEnabled: true,
        searchQueryLength: 0,
        mobileSellFocus: false,
        isDesktopCatalogUi: true,
      }),
    ).toBe(true);
    expect(
      isSellHierarchyCatalogNav({
        catalogHierarchyEnabled: true,
        searchQueryLength: 0,
        mobileSellFocus: true,
        isDesktopCatalogUi: false,
      }),
    ).toBe(true);
    expect(
      isSellHierarchyCatalogNav({
        catalogHierarchyEnabled: true,
        searchQueryLength: 9,
        mobileSellFocus: false,
        isDesktopCatalogUi: true,
      }),
    ).toBe(false);
    expect(
      isSellHierarchyCatalogNav({
        catalogHierarchyEnabled: false,
        searchQueryLength: 0,
        mobileSellFocus: false,
        isDesktopCatalogUi: true,
      }),
    ).toBe(false);
    expect(
      isSellHierarchyCatalogNav({
        catalogHierarchyEnabled: true,
        searchQueryLength: 0,
        mobileSellFocus: false,
        isDesktopCatalogUi: false,
      }),
    ).toBe(false);
  });

  it("renders a flat rail, never a recursive tree", () => {
    const html = renderToStaticMarkup(
      createElement(DesktopCategoryRail, {
        lang: "en",
        shelves: [card("LAPTOPS", "Laptops"), card("DESKTOPS", "Desktops")],
        selectedKey: "",
        onSelect: () => undefined,
        preserveOrder: true,
        showAll: false,
        showBack: true,
      }),
    );
    expect(html.match(/<nav/g)?.length).toBe(1);
    expect(html).not.toContain("<ul");
    expect(html).not.toContain('role="tree"');
    expect(html).not.toContain("Electronics");
    expect(html).toContain("Laptops");
    expect(html).toContain("Desktops");
    expect(html).toContain("←");
  });
});
