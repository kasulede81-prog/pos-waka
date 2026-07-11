import type { Language, Sale, SaleLine, ShopPreferences, TableSession } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { ModalSheet } from "../layout/ModalSheet";
import { billDraftFromSale, computeRestaurantBillTotals } from "../../lib/restaurantBilling";
import { buildReceiptBrandingSnapshot } from "../../lib/receiptBranding";
import { resolveStorePlanTier } from "../../lib/productPlanEnforcement";
import { getStoreSubscriptionContext } from "../../lib/storeSubscriptionContext";

type Props = {
  lang: Language;
  open: boolean;
  session: TableSession;
  tableLabel: string;
  areaName?: string | null;
  lines: SaleLine[];
  cartDiscountUgx: number;
  pendingSale?: Sale;
  preferences: ShopPreferences;
  onClose: () => void;
};

export function BillPreviewSheet({
  lang,
  open,
  session,
  tableLabel,
  areaName,
  lines,
  cartDiscountUgx,
  pendingSale,
  preferences,
  onClose,
}: Props) {
  const billDraft = billDraftFromSale(pendingSale, preferences);
  const totals = computeRestaurantBillTotals({ lines, cartDiscountUgx, billDraft, prefs: preferences });
  const { snapshot, authMode } = getStoreSubscriptionContext();
  const tier = resolveStorePlanTier(snapshot, authMode);
  const branding = buildReceiptBrandingSnapshot(preferences, tier);
  const shopName = branding.header.lines?.[0]?.trim() || preferences.shopDisplayName?.trim() || "Waka POS";

  if (!open) return null;

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[75]"
      clearNav={false}
      align="center"
      title={
        <div className="text-center">
          <h2 className="text-lg font-black text-foreground">{shopName}</h2>
          <p className="text-sm font-bold text-muted-foreground">{t(lang, "restaurantBillPreviewTitle")}</p>
        </div>
      }
    >
      <div className="mx-auto max-w-sm rounded-2xl border border-border bg-card p-4 font-mono text-xs shadow-inner">
        <p className="text-center font-black">{shopName}</p>
        {branding.header.lines?.[1] ? <p className="text-center text-muted-foreground">{branding.header.lines[1]}</p> : null}
        <hr className="my-2 border-dashed border-border" />
        <p>
          <strong>{t(lang, "restaurantBillTable")}:</strong> {tableLabel}
        </p>
        {areaName ? (
          <p>
            <strong>{t(lang, "restaurantBillArea")}:</strong> {areaName}
          </p>
        ) : null}
        <p>
          <strong>{t(lang, "tableOrderGuests")}:</strong> {session.guestCount}
        </p>
        {session.waiterLabel ? (
          <p>
            <strong>{t(lang, "restaurantBillWaiter")}:</strong> {session.waiterLabel}
          </p>
        ) : null}
        <hr className="my-2 border-dashed border-border" />
        {lines.map((line) => (
          <div key={line.id ?? line.productId} className="mb-1 flex justify-between gap-2">
            <span className="min-w-0 truncate">
              {line.quantity} {line.name}
            </span>
            <span>{formatUgx(line.lineTotalUgx)}</span>
          </div>
        ))}
        <hr className="my-2 border-dashed border-border" />
        <div className="flex justify-between">
          <span>{t(lang, "subtotal")}</span>
          <span>{formatUgx(totals.listSubtotalUgx)}</span>
        </div>
        {totals.lineDiscountUgx + totals.cartDiscountUgx > 0 ? (
          <div className="flex justify-between">
            <span>{t(lang, "discount")}</span>
            <span>-{formatUgx(totals.lineDiscountUgx + totals.cartDiscountUgx)}</span>
          </div>
        ) : null}
        {totals.serviceChargeUgx > 0 ? (
          <div className="flex justify-between">
            <span>{t(lang, "restaurantBillServiceCharge")}</span>
            <span>{formatUgx(totals.serviceChargeUgx)}</span>
          </div>
        ) : null}
        {totals.tipUgx > 0 ? (
          <div className="flex justify-between">
            <span>{t(lang, "restaurantBillTip")}</span>
            <span>{formatUgx(totals.tipUgx)}</span>
          </div>
        ) : null}
        <div className="mt-1 flex justify-between font-black">
          <span>{t(lang, "grandTotal")}</span>
          <span>{formatUgx(totals.grandTotalUgx)}</span>
        </div>
        {billDraft.payments.length > 0 ? (
          <>
            <hr className="my-2 border-dashed border-border" />
            <p className="font-black">{t(lang, "restaurantBillPaymentSummary")}</p>
            {billDraft.payments.map((p) => (
              <div key={p.id} className="flex justify-between">
                <span>{t(lang, `paymentMethod_${p.method}`)}</span>
                <span>{formatUgx(p.amountUgx)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold">
              <span>{t(lang, "restaurantBillBalance")}</span>
              <span>{formatUgx(totals.remainingBalanceUgx)}</span>
            </div>
          </>
        ) : null}
        <p className="mt-4 text-center text-[10px] text-muted-foreground">{t(lang, "restaurantBillQrFuture")}</p>
      </div>
    </ModalSheet>
  );
}
