import { describe, expect, it } from "vitest";
import {
  resolvePosLayoutModeZoomSafe,
  resolvePosLayoutWidthPx,
  resolvePosSellWorkspaceMode,
} from "./posSellWorkspace";

describe("posSellWorkspace", () => {
  it("resolves workspace modes in priority order", () => {
    expect(
      resolvePosSellWorkspaceMode({
        receiptOpen: true,
        searchQuery: "x",
        draftLineCount: 2,
        checkoutExpanded: true,
        paymentWorkspaceActive: true,
      }),
    ).toBe("receipt");
    expect(
      resolvePosSellWorkspaceMode({
        receiptOpen: false,
        searchQuery: "",
        draftLineCount: 2,
        checkoutExpanded: true,
        paymentWorkspaceActive: true,
      }),
    ).toBe("payment");
    expect(
      resolvePosSellWorkspaceMode({
        receiptOpen: false,
        searchQuery: "cola",
        draftLineCount: 1,
        checkoutExpanded: true,
        paymentWorkspaceActive: false,
      }),
    ).toBe("cart_review");
    expect(
      resolvePosSellWorkspaceMode({
        receiptOpen: false,
        searchQuery: "cola",
        draftLineCount: 0,
        checkoutExpanded: false,
        paymentWorkspaceActive: false,
      }),
    ).toBe("searching");
    expect(
      resolvePosSellWorkspaceMode({
        receiptOpen: false,
        searchQuery: "",
        draftLineCount: 0,
        checkoutExpanded: false,
        paymentWorkspaceActive: false,
      }),
    ).toBe("browsing");
  });

  it("keeps desktop band when maximized screen is browser-zoomed", () => {
    expect(
      resolvePosLayoutWidthPx({ innerWidth: 911, outerWidth: 1366, screenWidth: 1366 }),
    ).toBeGreaterThanOrEqual(1024);
    expect(
      resolvePosLayoutModeZoomSafe({ innerWidth: 911, outerWidth: 1366, screenWidth: 1366 }),
    ).toBe("full");
  });

  it("does not force desktop for a real narrow window on a wide screen", () => {
    expect(
      resolvePosLayoutModeZoomSafe({ innerWidth: 900, outerWidth: 920, screenWidth: 1920 }),
    ).toBe("compact");
  });

  it("keeps tablet band when phone-width CSS is a zoomed tablet screen", () => {
    expect(
      resolvePosLayoutModeZoomSafe({ innerWidth: 640, outerWidth: 1024, screenWidth: 1024 }),
    ).toBe("compact");
  });
});
