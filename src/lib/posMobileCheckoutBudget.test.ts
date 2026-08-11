import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  POS_MOBILE_CHECKOUT_CATALOG_PEEK_DVH,
  POS_MOBILE_CHECKOUT_FORBIDDEN_MAX_HEIGHTS,
  POS_MOBILE_CHECKOUT_PINNED_ZONES,
  POS_MOBILE_CHECKOUT_SCROLL_ZONE,
  POS_MOBILE_CHECKOUT_WORKSPACE_CLASS,
  POS_MOBILE_CHECKOUT_WORKSPACE_HEIGHT,
} from "./posMobileCheckoutBudget";

describe("posMobileCheckoutBudget (M1.1-R5)", () => {
  it("owns the full mobile viewport with no catalog peek", () => {
    expect(POS_MOBILE_CHECKOUT_WORKSPACE_HEIGHT).toBe("100dvh");
    expect(POS_MOBILE_CHECKOUT_CATALOG_PEEK_DVH).toBe(0);
  });

  it("forbids partial-height sheet budgets from R2–R4", () => {
    for (const bad of POS_MOBILE_CHECKOUT_FORBIDDEN_MAX_HEIGHTS) {
      expect(POS_MOBILE_CHECKOUT_WORKSPACE_HEIGHT).not.toContain(bad);
    }
  });

  it("pins totals, payment, and action — only cart scrolls", () => {
    expect(POS_MOBILE_CHECKOUT_SCROLL_ZONE).toBe("cart");
    expect(POS_MOBILE_CHECKOUT_PINNED_ZONES).toEqual(["totals", "payment", "action"]);
  });

  it("wires full-screen workspace into index.css", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toContain(`.${POS_MOBILE_CHECKOUT_WORKSPACE_CLASS}`);
    expect(css).toContain("height: 100dvh");
    expect(css).not.toMatch(/\.pos-mobile-checkout-workspace\s*\{[^}]*(72|88|90)dvh/);
  });

  it("wires full-screen workspace into PosPage (no dimmed peek sheet)", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/PosPage.tsx"), "utf8");
    expect(page).toContain(POS_MOBILE_CHECKOUT_WORKSPACE_CLASS);
    expect(page).toContain("sheetInsetOwned");
    expect(page).not.toContain("pos-mobile-checkout-sheet");
    expect(page).not.toContain("max-h-[min(88dvh,40rem)]");
    expect(page).not.toContain("max-h-[min(90dvh");
    expect(page).not.toContain("justify-end md:hidden");
  });

  it("keeps composition zones in PosCheckoutPanel", () => {
    const panel = readFileSync(resolve(process.cwd(), "src/components/pos/PosCheckoutPanel.tsx"), "utf8");
    expect(panel).toContain('data-pos-checkout-zone="cart"');
    expect(panel).toContain('data-pos-checkout-zone="totals"');
    expect(panel).toContain('data-pos-checkout-zone="payment"');
    expect(panel).toContain('data-pos-checkout-zone="action"');
  });
});
