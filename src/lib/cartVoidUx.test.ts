import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("cashier cart-exit Void UX wiring", () => {
  it("Sell uses Clear / Leave confirmation through useCartAbandonVoid, never a dedicated Void button", () => {
    const pos = src("src/pages/PosPage.tsx");
    expect(pos).toContain("useCartAbandonVoid");
    expect(pos).toContain("CartVoidConfirmDialog");
    expect(pos).toContain("requestClear");
    expect(pos).toContain("requestRemoveLine");
    expect(pos).not.toMatch(/onRemoveLine: removeDraftLine/);
    expect(pos).toContain('modeTerm("clearSale")');
    expect(pos).not.toContain("cartVoidCopyKeys");
    expect(pos).not.toContain("leaveSellConfirmKey");
    expect(pos).not.toMatch(/window\.confirm\(t\(lang, clearDraft/);
    expect(pos).not.toMatch(/voidSaleLine\(/);
    expect(pos).not.toContain("usePosStore.getState().clearDraft()");
  });

  it("shared abandon hook voids unsaved carts and preserves pending-leave semantics", () => {
    const hook = src("src/hooks/useCartAbandonVoid.ts");
    expect(hook).toContain("resolveCartAbandon");
    expect(hook).toContain("voidCurrentCart");
    expect(hook).toContain("registerPosLeaveGuard");
    expect(hook).toContain("discard_pending_edits");
    expect(hook).toContain("clearDraft");
    expect(hook).not.toContain("voidSaleLine");
    expect(hook).not.toContain("finalizeDraftSale");
    expect(hook).toContain("flushWaiters(false)");
    expect(hook).toContain("requestRemoveLine");
    expect(hook).toContain("resolveRemoveDraftLine");
    expect(hook).toContain("resolveDraftQtyChange");
  });

  it("hardware back from Sell treats history-back as leaving Sell", () => {
    const back = src("src/hooks/useAndroidBackButton.ts");
    expect(back).toContain("confirmLeavePosIfNeeded");
    expect(back).toContain('historyCanGoBack() ? "/" : fallback');
  });

  it("pharmacy dispense uses the same Clear → Void path", () => {
    const hook = src("src/hooks/usePharmacyDispenseCheckout.ts");
    expect(hook).toContain("useCartAbandonVoid");
    expect(hook).toContain("pharmacyTerm_clearBasket");
    expect(hook).toContain("requestRemoveLine");
    expect(hook).not.toContain("onRemoveLine: removeDraftLine");
    expect(hook).not.toContain("cartVoidCopyKeys");
    expect(hook).not.toContain("window.confirm");
    expect(hook).not.toContain("voidSaleLine");
    const workspace = src("src/components/pharmacy/dispense/PharmacyDispenseWorkspace.tsx");
    expect(workspace).toContain("CartVoidConfirmDialog");
  });

  it("hospitality table settle cleanup stays distinct from cart Void and settled-bill void", () => {
    const table = src("src/pages/TableOrderPage.tsx");
    expect(table).toContain("clearActiveTableOrder");
    expect(table).toContain("handleBillFinalized");
    expect(table).not.toContain("voidCurrentCart");
    expect(table).not.toContain("voidSettledTableBill");
  });

  it("product editor, wizard, and settings discard dialogs are unchanged", () => {
    const editor = src("src/components/stock/editor/ProductEditorShell.tsx");
    expect(editor).toContain("productEditorDiscardConfirm");
    expect(editor).not.toContain("voidCurrentCart");
    expect(editor).not.toContain("CartVoidConfirmDialog");
    const wizard = src("src/components/stock/wizard/ProductWizardShell.tsx");
    expect(wizard).toContain("productEditorDiscardConfirm");
    expect(wizard).not.toContain("voidCurrentCart");
    const settings = src("src/components/enterprise/SettingsAutoSaveShell.tsx");
    expect(settings).not.toContain("voidCurrentCart");
    expect(settings).not.toContain("CartVoidConfirmDialog");
    expect(settings).not.toContain("useCartAbandonVoid");
    const prefs = src("src/components/enterprise/preferencesAutoSaveContext.tsx");
    expect(prefs).not.toContain("voidCurrentCart");
    expect(prefs).not.toContain("CartVoidConfirmDialog");
  });

  it("checkout Clear is labeled Clear, not a dedicated Void sale button", () => {
    const panel = src("src/components/pos/PosCheckoutPanel.tsx");
    expect(panel).toContain("clearSaleLabel");
    expect(panel).toContain("onClearDraft");
    expect(panel).not.toContain("voidCurrentCart");
    expect(panel).not.toContain("cartVoidCopy");
    expect(panel).not.toMatch(/Void sale/);
    const pos = src("src/pages/PosPage.tsx");
    expect(pos).not.toMatch(/cartVoidCopy\.labelKey/);
    expect(pos).not.toMatch(/voidPendingSaleLabel/);
  });
});
