import { describe, expect, it, vi } from "vitest";
import {
  WALLET_CARD_SHARE_INTRO,
  buildSmsShareHref,
  buildWalletCardShareText,
  buildWhatsAppShareHref,
  copyWalletLink,
  isWebShareAvailable,
  openWalletLinkOnThisDevice,
  shareWalletLinkViaWebShare,
} from "./loyaltyWalletShare";

const SAVE_URL = "https://pay.google.com/gp/v/save/test.jwt.token";

describe("loyaltyWalletShare", () => {
  it("builds share text with intro + exact Save URL", () => {
    const text = buildWalletCardShareText(SAVE_URL);
    expect(text).toContain(WALLET_CARD_SHARE_INTRO);
    expect(text).toContain(SAVE_URL);
    expect(text.endsWith(SAVE_URL)).toBe(true);
  });

  it("builds WhatsApp href with encoded message and Save URL", () => {
    const href = buildWhatsAppShareHref(SAVE_URL);
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    const q = new URL(href).searchParams.get("text") ?? "";
    expect(q).toContain(WALLET_CARD_SHARE_INTRO);
    expect(q).toContain(SAVE_URL);
  });

  it("builds SMS href with body containing Save URL", () => {
    const href = buildSmsShareHref(SAVE_URL);
    expect(href.startsWith("sms:?body=")).toBe(true);
    const body = decodeURIComponent(href.slice("sms:?body=".length));
    expect(body).toContain(WALLET_CARD_SHARE_INTRO);
    expect(body).toContain(SAVE_URL);
  });

  it("copies the exact Save URL to clipboard", async () => {
    const writeText = vi.fn(async () => undefined);
    const result = await copyWalletLink(SAVE_URL, { writeText });
    expect(result).toBe("copied");
    expect(writeText).toHaveBeenCalledWith(SAVE_URL);
  });

  it("returns failed when clipboard is unavailable", async () => {
    expect(await copyWalletLink(SAVE_URL, null)).toBe("failed");
  });

  it("detects Web Share availability", () => {
    expect(isWebShareAvailable(undefined)).toBe(false);
    expect(isWebShareAvailable(async () => undefined)).toBe(true);
  });

  it("shares via Web Share with Save URL (never requires logging)", async () => {
    const share = vi.fn(async (data: ShareData) => {
      expect(data.url).toBe(SAVE_URL);
      expect(data.text).toBe(WALLET_CARD_SHARE_INTRO);
    });
    const result = await shareWalletLinkViaWebShare(SAVE_URL, share as typeof navigator.share);
    expect(result).toBe("shared");
    expect(share).toHaveBeenCalledOnce();
  });

  it("maps Web Share abort to cancelled", async () => {
    const share = vi.fn(async () => {
      const err = new Error("user cancelled");
      err.name = "AbortError";
      throw err;
    });
    expect(await shareWalletLinkViaWebShare(SAVE_URL, share as typeof navigator.share)).toBe("cancelled");
  });

  it("returns unavailable when Web Share is missing", async () => {
    expect(await shareWalletLinkViaWebShare(SAVE_URL, undefined)).toBe("unavailable");
  });

  it("opens Save URL on this device", () => {
    const open = vi.fn(() => ({}) as Window);
    expect(openWalletLinkOnThisDevice(SAVE_URL, open)).toBe(true);
    expect(open).toHaveBeenCalledWith(SAVE_URL, "_blank", "noopener,noreferrer");
  });

  it("does not include Save URL in exported constant intro", () => {
    expect(WALLET_CARD_SHARE_INTRO).not.toContain("pay.google.com");
    expect(WALLET_CARD_SHARE_INTRO).not.toContain("save/");
  });
});
