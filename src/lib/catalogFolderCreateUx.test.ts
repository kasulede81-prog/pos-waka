import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CatalogNode } from "../types";
import {
  catalogCreateInsideParentId,
  catalogCreateIntentParentId,
  expandAncestorsForCreatedFolder,
  LOCAL_CATALOG_SHOP_ID,
  planReparentCatalogNode,
} from "./catalogHierarchy";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function node(partial: Partial<CatalogNode> & Pick<CatalogNode, "id" | "legacyShelfKey">): CatalogNode {
  return {
    shopId: LOCAL_CATALOG_SHOP_ID,
    parentId: null,
    name: partial.legacyShelfKey,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

describe("Settings catalog folder create UX wiring", () => {
  it("keeps + Create folder as top-level and adds Add child folder on rows", () => {
    const panel = src("src/components/pos/CatalogFoldersPanel.tsx");
    expect(panel).toContain("catalogFoldersCreate");
    expect(panel).toContain('catalogCreateIntentParentId("top-level"');
    expect(panel).toContain("catalogFoldersAddChild");
    expect(panel).toContain('catalogCreateIntentParentId("child"');
    expect(panel).toContain("setSelectedId(created.id)");
    expect(panel).toContain("expandAncestorsForCreatedFolder");
    expect(panel).toContain("CatalogCreateFolderForm");
    expect(panel).toContain("canPersistCatalogShelfPreferences");
    expect(panel).toContain("min-h-[44px]");
    expect(panel).not.toMatch(/Parent shelf/);
    expect(panel).not.toMatch(/drag/i);
  });

  it("hides create actions when the actor cannot persist CatalogNodes", () => {
    const panel = src("src/components/pos/CatalogFoldersPanel.tsx");
    expect(panel).toContain("if (!canCreate) return");
    expect(panel).toMatch(/canCreate \? \([\s\S]*catalogFoldersCreate/);
    expect(panel).toMatch(/canCreate \? \([\s\S]*catalogFoldersAddChild/);
  });

  it("create form uses Folder name / Inside and keeps parent dropdown as a secondary unlock", () => {
    const form = src("src/components/pos/CatalogCreateFolderForm.tsx");
    expect(form).toContain("catalogFolderName");
    expect(form).toContain("catalogFolderInside");
    expect(form).toContain("catalogFolderInsideTop");
    expect(form).toContain("catalogFolderChangeParent");
    expect(form).toContain("catalogFoldersCreateAction");
    expect(form).not.toMatch(/Parent shelf/);
    expect(form).not.toMatch(/catalogShelfParent/);
  });

  it("flag OFF still hides Catalog folders and keeps CategoryShelfPicker", () => {
    const arrange = src("src/components/pos/PosShelfArrangePanel.tsx");
    expect(arrange).toMatch(/hierarchyOn \? <CatalogFoldersPanel/);
    const picker = src("src/components/stock/ShelfDestinationPicker.tsx");
    expect(picker).toContain("CategoryShelfPicker");
    expect(picker).toContain("HierarchyShelfPicker");
    expect(picker).toContain("if (!enabled)");
  });
});

describe("Add Product folder create UX wiring", () => {
  it("creates inside the selected folder and shows Folder for this product", () => {
    const picker = src("src/components/stock/HierarchyShelfPicker.tsx");
    expect(picker).toContain("catalogProductFolderBanner");
    expect(picker).toContain("catalogCreateInside");
    expect(picker).toContain("catalogCreateInsideParentId");
    expect(picker).toContain("nextDestinationAfterCatalogCreate");
    expect(picker).toContain("canPersistCatalogShelfPreferences");
    expect(picker).toContain("assignmentCategoryFromPickerItem");
    expect(picker).not.toMatch(/catalogNodeId/);
    expect(picker).not.toMatch(/onChange\(fallback\)/);
  });

  it("wizard copy uses folder language only when hierarchy is on", () => {
    const wizard = src("src/components/stock/SimpleAddProductWizard.tsx");
    expect(wizard).toContain("catalogAddProductFolderTitle");
    expect(wizard).toContain("catalogAddProductFolderHint");
    expect(wizard).toContain("simpleAddStep2Title");
    expect(wizard).toContain("isCatalogHierarchyEnabled(preferences)");
  });
});

describe("create UX parent defaults", () => {
  it("Add child folder never requires searching the parent dropdown", () => {
    expect(catalogCreateIntentParentId("child", "n-computers")).toBe("n-computers");
    expect(catalogCreateIntentParentId("top-level", "n-computers")).toBeNull();
  });

  it("after a child is created, ancestors expand so the next Add child is on the new folder", () => {
    const nodes = [
      node({ id: "n-el", legacyShelfKey: "Electronics" }),
      node({ id: "n-comp", parentId: "n-el", legacyShelfKey: "Computers" }),
    ];
    const selectedId = "n-comp";
    const expanded = expandAncestorsForCreatedFolder(nodes, "n-el", new Set());
    expect(expanded.has("n-el")).toBe(true);
    expect(catalogCreateIntentParentId("child", selectedId)).toBe("n-comp");
  });

  it("cannot create cycles via reparent even when the dropdown is unlocked", () => {
    const electronics = node({ id: "n-el", legacyShelfKey: "Electronics" });
    const computers = node({ id: "n-comp", parentId: "n-el", legacyShelfKey: "Computers" });
    const laptops = node({ id: "n-lap", parentId: "n-comp", legacyShelfKey: "Laptops" });
    expect(
      planReparentCatalogNode({
        nodeId: "n-el",
        parentId: "n-lap",
        nodes: [electronics, computers, laptops],
        shopId: LOCAL_CATALOG_SHOP_ID,
      }),
    ).toEqual({ ok: false, errorKey: "catalogReparentCycle" });
  });

  it("Add Product create-inside defaults to the selected persisted folder", () => {
    expect(catalogCreateInsideParentId({ id: "n-dell", persisted: true })).toBe("n-dell");
    expect(catalogCreateInsideParentId({ id: "legacy-DELL", persisted: false })).toBe("");
  });
});
