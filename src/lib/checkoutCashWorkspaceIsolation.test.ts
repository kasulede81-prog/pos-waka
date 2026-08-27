import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("checkout cash workspace isolation", () => {
  it("desktop catalog dock mounts the expanded cash picker beside a compact keypad", () => {
    const src = readSrc("src/components/pos/PosDesktopCatalogCheckoutDock.tsx");
    expect(src).toContain('from "./CheckoutNotePicker"');
    expect(src).toContain("data-checkout-cash-workspace");
    expect(src).toContain("w-[13.5rem]");
    expect(src).toContain("bg-card/80");
    expect(src).toContain("backdrop-blur-md");
  });

  it("compact checkout slideover does not import or render the cash picker", () => {
    const src = readSrc("src/components/pos/PosCompactCheckoutSlideover.tsx");
    expect(src).not.toContain("CheckoutNotePicker");
    expect(src).not.toContain("onAddCashNote");
    expect(src).not.toContain("currency/ugx");
  });

  it("mobile/shared checkout panel does not import the visual cash picker", () => {
    const src = readSrc("src/components/pos/PosCheckoutPanel.tsx");
    expect(src).not.toContain("CheckoutNotePicker");
    expect(src).not.toContain("checkoutNoteAssetPath");
    expect(src).not.toContain("checkoutCoinAssetPath");
  });

  it("PosPage wires denomination taps only into the desktop catalog dock", () => {
    const src = readSrc("src/pages/PosPage.tsx");
    expect(src).toContain("onAddCashNote={addCheckoutCashNote}");
    expect(src).not.toContain('from "../components/pos/CheckoutNotePicker"');
  });

  it("counting field still uses the full denomination list including 100,000", () => {
    const src = readSrc("src/components/cash/CashDenominationCountField.tsx");
    expect(src).toContain("UGX_DENOMINATIONS");
    expect(src).not.toContain("UGX_CHECKOUT_NOTE_DENOMINATIONS");
    expect(src).not.toContain("UGX_CHECKOUT_COIN_DENOMINATIONS");
  });

  it("picker renders all six notes and three coins as real controls", () => {
    const src = readSrc("src/components/pos/CheckoutNotePicker.tsx");
    expect(src).toContain("UGX_CHECKOUT_NOTE_DENOMINATIONS");
    expect(src).toContain("UGX_CHECKOUT_COIN_DENOMINATIONS");
    expect(src).toContain("data-checkout-note-grid");
    expect(src).toContain("data-checkout-coin-row");
    expect(src).toContain("grid-rows-2");
    expect(src).toContain("Add UGX ${formatDenominationLabel(denom)} cash note");
    expect(src).toContain("Add UGX ${formatDenominationLabel(denom)} coin");
    expect(src).toContain("onAddNote(denom)");
  });
});
