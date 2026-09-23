import { describe, expect, it, vi } from "vitest";
import { openWalletSaveUrlWithoutReferrer } from "./loyaltyPublicWalletNavigate";
import { isMarketingIndexablePath, noIndexSeoTitle } from "../../config/seoRoutes";
import { posCanonical } from "../../config/company";

const SAVE_URL = "https://pay.google.com/gp/v/save/test.jwt";
const TOKEN = "d".repeat(64);

describe("openWalletSaveUrlWithoutReferrer (F2)", () => {
  it("prefers popup with noopener,noreferrer", () => {
    const open = vi.fn(() => ({}) as Window);
    expect(openWalletSaveUrlWithoutReferrer(SAVE_URL, { open })).toBe("opened_tab");
    expect(open).toHaveBeenCalledWith(SAVE_URL, "_blank", "noopener,noreferrer");
  });

  it("falls back to noreferrer anchor — never location.assign", () => {
    const open = vi.fn(() => null);
    const click = vi.fn();
    const remove = vi.fn();
    const anchor = {
      href: "",
      rel: "",
      target: "",
      click,
      remove,
    } as unknown as HTMLAnchorElement;
    const createAnchor = vi.fn(() => anchor);
    const append = vi.fn();
    const result = openWalletSaveUrlWithoutReferrer(SAVE_URL, {
      open,
      createAnchor,
      append,
      remove: (el) => {
        expect(el).toBe(anchor);
        remove();
      },
    });
    expect(result).toBe("same_tab_noreferrer");
    expect(anchor.href).toBe(SAVE_URL);
    expect(anchor.rel).toContain("noreferrer");
    expect(click).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledOnce();
  });

  it("returns failed for empty Save URL", () => {
    expect(openWalletSaveUrlWithoutReferrer("")).toBe("failed");
  });
});

describe("public loyalty SEO (W3)", () => {
  it("keeps loyalty pages noindex and uses token-free pos canonical", () => {
    const path = `/loyalty/${TOKEN}`;
    expect(isMarketingIndexablePath(path)).toBe(false);
    expect(noIndexSeoTitle(path)).toBe("WAKA Loyalty");
    const canonical = posCanonical("/loyalty");
    expect(canonical).toBe("https://pos.waka.ug/loyalty");
    expect(canonical).not.toContain(TOKEN);
  });
});
