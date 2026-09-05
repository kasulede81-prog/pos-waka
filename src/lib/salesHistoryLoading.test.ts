import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { salesHistoryShowsInitialSkeleton } from "./salesHistoryLoading";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("salesHistoryShowsInitialSkeleton", () => {
  it("shows skeleton only when deferred sales are still empty", () => {
    expect(salesHistoryShowsInitialSkeleton(true, 0)).toBe(true);
    expect(salesHistoryShowsInitialSkeleton(false, 0)).toBe(false);
  });

  it("does not replace a painted list while deferred value catches up", () => {
    expect(salesHistoryShowsInitialSkeleton(true, 100)).toBe(false);
    expect(salesHistoryShowsInitialSkeleton(true, 1)).toBe(false);
    expect(salesHistoryShowsInitialSkeleton(false, 100)).toBe(false);
  });
});

describe("ReceiptsPage hydration blink wiring", () => {
  it("keeps useDeferredValue and only skeletons on true initial load", () => {
    const page = src("src/pages/ReceiptsPage.tsx");
    expect(page).toContain("useDeferredValue(rawSales)");
    expect(page).toContain("salesHistoryShowsInitialSkeleton(salesRefreshing, sales.length)");
    expect(page).toContain("showInitialSkeleton ? (");
    expect(page).toContain("<SalesHistorySkeletonList />");
    expect(page).not.toMatch(/salesRefreshing\s*\?\s*\(\s*<SalesHistorySkeletonList/);
  });
});
