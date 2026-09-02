import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HOME_COMPOSITION_COLUMNS,
  HOME_COMPOSITION_SPAN,
  homeCommandLastTileSpansRow,
} from "./homeComposition";
import { HOME_REGION_ORDER_LARGE, homeCommandPrimaryItemClass } from "./homePresentation";

function readSrc(relativeFromLib: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativeFromLib), "utf8");
}

describe("HOME V8 composition", () => {
  it("uses a 12-column track that sums to the full canvas", () => {
    expect(HOME_COMPOSITION_COLUMNS).toBe(12);
    expect(HOME_COMPOSITION_SPAN.heroLead + HOME_COMPOSITION_SPAN.heroSupport).toBe(12);
    expect(HOME_COMPOSITION_SPAN.heroMetrics + HOME_COMPOSITION_SPAN.heroShop + HOME_COMPOSITION_SPAN.heroHealth).toBe(12);
    expect(HOME_COMPOSITION_SPAN.primary + HOME_COMPOSITION_SPAN.live).toBe(12);
    expect(HOME_REGION_ORDER_LARGE).toEqual(["hero", "primary", "reports", "operations", "admin"]);
  });

  it("fills an odd primary count without row-span holes", () => {
    expect(homeCommandLastTileSpansRow(0, 3)).toBe(false);
    expect(homeCommandLastTileSpansRow(1, 3)).toBe(false);
    expect(homeCommandLastTileSpansRow(2, 3)).toBe(true);
    expect(homeCommandLastTileSpansRow(3, 4)).toBe(false);
    expect(homeCommandPrimaryItemClass(2, 3)).toContain("col-span-2");
    expect(homeCommandPrimaryItemClass(2, 3)).not.toContain("row-span-2");
    expect(homeCommandPrimaryItemClass()).toBe("min-w-0");
  });

  it("maps the 12-column composition onto CSS without clipped-stage leftovers", () => {
    const css = readSrc("../index.css");
    expect(css).toContain("repeat(12, minmax(0, 1fr))");
    expect(css).toContain("grid-column: span 7");
    expect(css).toContain("grid-column: span 5");
    expect(css).toContain("home-new-sale-cta");
    expect(css).not.toContain("minmax(11.25rem, 0.34fr)");
    expect(css).not.toContain("grid-auto-flow: column");

    const pulse = readSrc("../components/home/LivingBusinessPulse.tsx");
    expect(pulse).toContain("home-living-pulse__composition");
    expect(pulse).toContain("home-living-pulse--console");
    expect(pulse).toContain("onClick={onSell}");
    expect(pulse).not.toContain("from \"three\"");

    const reports = readSrc("../components/home/HomeReportsPreview.tsx");
    expect(reports).toContain("data-home-live-engine");
    expect(reports).toContain("sellStat");
    expect(reports).toContain("healthItems");
    expect(reports).toContain('SectionTitle as="span"');
  });
});
