import { memo, type RefObject } from "react";
import clsx from "clsx";
import type { Language, Product, SaleLine } from "../../types";
import { t } from "../../lib/i18n";
import type { DraftCartStats, DraftCheckoutTotals } from "../../lib/draftCart";
import { DraftCartLineRow } from "./DraftCartLineRow";
import { DraftCartSummary } from "./DraftCartSummary";

type PaymentMethod = "cash" | "atm" | "mobile_money" | "mixed" | "credit";
type CheckoutAmountField = "cash" | "mobile";

const Numpad = memo(function Numpad({
  onDigit,
  onClear,
  allowDecimal,
}: {
  onDigit: (d: string) => void;
  onClear: () => void;
  allowDecimal: boolean;
}) {
  const row4 = allowDecimal ? [".", "0", "⌫"] : ["0", "⌫", "C"];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onDigit(k)}
            className="min-h-[56px] rounded-2xl bg-slate-100 py-3 text-2xl font-semibold text-slate-900 active:bg-slate-200 active:brightness-95 motion-reduce:active:brightness-100"
          >
            {k}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {row4.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              if (k === "C") onClear();
              else if (k === "⌫") onDigit("back");
              else onDigit(k);
            }}
            className="min-h-[56px] rounded-2xl bg-slate-100 py-3 text-2xl font-semibold text-slate-900 active:bg-slate-200 active:brightness-95"
          >
            {k}
          </button>
        ))}
      </div>
      {allowDecimal && (
        <button
          type="button"
          onClick={onClear}
          className="w-full min-h-[52px] rounded-2xl bg-amber-100 py-3 text-lg font-bold text-amber-900 active:bg-amber-200"
        >
          C
        </button>
      )}
    </div>
  );
});

export type PosCheckoutPanelProps = {
  lang: Language;
  variant: "overlay" | "sidebar";
  saleTitle: string;
  clearSaleLabel: string;
  saveSaleLabel: string;
  draftLines: SaleLine[];
  draftCartStats: DraftCartStats;
  checkoutTotals: DraftCheckoutTotals;
  draftPayable: number;
  draftDiscountTotal: number;
  productById: Map<string, Product>;
  checkoutBlockMessage: string | null;
  paymentMethod: PaymentMethod;
  checkoutMethods: PaymentMethod[];
  cashInput: string;
  mobileMoneyInput: string;
  checkoutAmountField: CheckoutAmountField;
  changeDue: number;
  computedDebt: number;
  saleCustomerId: string;
  saleCustomerName: string;
  saleCustomerPhone: string;
  customers: { id: string; name: string; debtBalanceUgx: number }[];
  canSavePending: boolean;
  savePendingLabel: string;
  customerSelectRef?: RefObject<HTMLSelectElement | null>;
  saveButtonRef?: RefObject<HTMLButtonElement | null>;
  checkoutPanelRef?: RefObject<HTMLDivElement | null>;
  onClearDraft: () => void;
  onMinimize?: () => void;
  onIncrement: (line: SaleLine) => void;
  onDecrement: (line: SaleLine) => void;
  onQtyTap: (line: SaleLine) => void;
  onLineDiscount: (line: SaleLine) => void;
  onRemoveLine: (productId: string) => void;
  onOpenCartDiscount: () => void;
  onPaymentMethod: (method: PaymentMethod) => void;
  onCheckoutAmountField: (field: CheckoutAmountField) => void;
  onAppendCheckoutDigit: (d: string) => void;
  onClearCheckoutAmount: () => void;
  onSaleCustomerId: (id: string) => void;
  onSaleCustomerName: (name: string) => void;
  onSaleCustomerPhone: (phone: string) => void;
  onSavePending: () => void;
  onFinishSale: () => void;
};

export function PosCheckoutPanel({
  lang,
  variant,
  saleTitle,
  clearSaleLabel,
  saveSaleLabel,
  draftLines,
  draftCartStats,
  checkoutTotals,
  draftPayable,
  draftDiscountTotal,
  productById,
  checkoutBlockMessage,
  paymentMethod,
  checkoutMethods,
  cashInput,
  mobileMoneyInput,
  checkoutAmountField,
  changeDue,
  computedDebt,
  saleCustomerId,
  saleCustomerName,
  saleCustomerPhone,
  customers,
  canSavePending,
  savePendingLabel,
  customerSelectRef,
  saveButtonRef,
  checkoutPanelRef,
  onClearDraft,
  onMinimize,
  onIncrement,
  onDecrement,
  onQtyTap,
  onLineDiscount,
  onRemoveLine,
  onOpenCartDiscount,
  onPaymentMethod,
  onCheckoutAmountField,
  onAppendCheckoutDigit,
  onClearCheckoutAmount,
  onSaleCustomerId,
  onSaleCustomerName,
  onSaleCustomerPhone,
  onSavePending,
  onFinishSale,
}: PosCheckoutPanelProps) {
  const isSidebar = variant === "sidebar";
  const emptyCart = draftLines.length === 0;

  return (
    <div
      ref={checkoutPanelRef}
      className={clsx(
        "flex min-h-0 flex-col",
        isSidebar
          ? "h-full max-h-[calc(100dvh-7rem)] rounded-[1.35rem] border border-waka-200 bg-waka-50/90 shadow-waka-sm"
          : "h-full bg-waka-50",
      )}
    >
      <header
        className={clsx(
          "flex shrink-0 items-center gap-2 border-b border-waka-200 bg-waka-50 px-3 py-3",
          isSidebar && "rounded-t-[1.35rem]",
        )}
      >
        <button
          type="button"
          onClick={onClearDraft}
          disabled={emptyCart}
          className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm active:bg-slate-50 disabled:opacity-40"
        >
          {clearSaleLabel}
        </button>
        <h2
          id="pos-checkout-title"
          className="min-w-0 flex-1 truncate text-center text-lg font-black text-waka-950"
        >
          {saleTitle}
        </h2>
        {!isSidebar && onMinimize ? (
          <button
            type="button"
            onClick={onMinimize}
            className="shrink-0 rounded-full border border-waka-300 bg-white px-3 py-2 text-sm font-bold text-waka-900 shadow-sm active:bg-waka-50"
          >
            {t(lang, "posAddMoreItems")}
          </button>
        ) : (
          <span className="w-[4.5rem] shrink-0" aria-hidden />
        )}
      </header>

      {checkoutBlockMessage ? (
        <div
          className="mx-3 mt-2 shrink-0 rounded-xl bg-red-600 px-4 py-3 text-center text-sm font-bold text-white shadow-sm"
          role="alert"
        >
          {checkoutBlockMessage}
        </div>
      ) : null}

      <div
        className={clsx(
          "min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 [-webkit-overflow-scrolling:touch]",
          isSidebar && "lg:p-3",
        )}
      >
        {emptyCart ? (
          <p className="py-8 text-center text-sm font-semibold text-slate-500">{t(lang, "posCartEmptyHint")}</p>
        ) : (
          <>
            <DraftCartSummary
              lang={lang}
              stats={draftCartStats}
              payableUgx={draftPayable}
              cartDiscountUgx={checkoutTotals.cartDiscountUgx}
              compact={isSidebar}
            />
            <ul className="mt-3 space-y-2 rounded-2xl border border-waka-200 bg-white p-3 shadow-sm">
              {draftLines.map((line) => (
                <DraftCartLineRow
                  key={line.productId}
                  lang={lang}
                  line={line}
                  product={productById.get(line.productId)}
                  onIncrement={() => onIncrement(line)}
                  onDecrement={() => onDecrement(line)}
                  onQtyTap={() => onQtyTap(line)}
                  onDiscount={() => onLineDiscount(line)}
                  onRemove={() => onRemoveLine(line.productId)}
                />
              ))}
            </ul>
            {draftDiscountTotal > 0 ? (
              <p className="mt-2 text-sm font-bold text-amber-800">
                {t(lang, "draftLineDiscountTotal")}: UGX {draftDiscountTotal.toLocaleString()}
              </p>
            ) : null}
            <div className="mt-4 rounded-2xl border border-waka-200 bg-waka-50/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-slate-800">{t(lang, "cartDiscountApplied")}</p>
                <button
                  type="button"
                  onClick={onOpenCartDiscount}
                  className="min-h-[44px] shrink-0 rounded-2xl border-2 border-waka-400 bg-white px-4 text-sm font-black text-waka-900 active:bg-waka-100"
                >
                  {t(lang, "cartDiscountBtn")}
                </button>
              </div>
              {checkoutTotals.cartDiscountUgx > 0 ? (
                <p className="mt-2 text-sm font-bold text-emerald-900">
                  − UGX {checkoutTotals.cartDiscountUgx.toLocaleString()}
                </p>
              ) : null}
            </div>
            {checkoutTotals.cartDiscountUgx > 0 ? (
              <p className="mt-3 text-sm font-semibold text-slate-600">
                {t(lang, "cartDiscountOriginal")}: UGX {checkoutTotals.lineSubtotalUgx.toLocaleString()}
              </p>
            ) : null}
            {(draftDiscountTotal > 0 || checkoutTotals.cartDiscountUgx > 0) && (
              <div className="mt-3 space-y-1 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-sm font-semibold text-slate-700">
                <p className="flex justify-between gap-2">
                  <span>{t(lang, "checkoutSubtotalLabel")}</span>
                  <span>UGX {(checkoutTotals.lineSubtotalUgx + draftDiscountTotal).toLocaleString()}</span>
                </p>
                {draftDiscountTotal > 0 ? (
                  <p className="flex justify-between gap-2 text-amber-900">
                    <span>{t(lang, "checkoutLineDiscountsLabel")}</span>
                    <span>− UGX {draftDiscountTotal.toLocaleString()}</span>
                  </p>
                ) : null}
                {checkoutTotals.cartDiscountUgx > 0 ? (
                  <p className="flex justify-between gap-2 text-emerald-900">
                    <span>{t(lang, "checkoutCartDiscountLabel")}</span>
                    <span>− UGX {checkoutTotals.cartDiscountUgx.toLocaleString()}</span>
                  </p>
                ) : null}
                <p className="flex justify-between gap-2 border-t border-slate-200 pt-2 font-black text-slate-900">
                  <span>{t(lang, "checkoutFinalTotalLabel")}</span>
                  <span>UGX {draftPayable.toLocaleString()}</span>
                </p>
              </div>
            )}
            <p className={clsx("mt-4 font-black text-slate-900", isSidebar ? "text-2xl" : "text-3xl")}>
              {checkoutTotals.cartDiscountUgx > 0 ? t(lang, "payableTotalLabel") : t(lang, "totalLabel")}{" "}
              <span className="text-waka-700">UGX {draftPayable.toLocaleString()}</span>
            </p>

            <div className="mt-4">
              <p className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "paymentMethodLabel")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {checkoutMethods.map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => {
                      onPaymentMethod(method);
                      if (method === "cash" || method === "credit") onCheckoutAmountField("cash");
                    }}
                    className={clsx(
                      "min-h-[48px] rounded-2xl border text-sm font-black",
                      paymentMethod === method
                        ? "border-waka-400 bg-waka-100 text-waka-950"
                        : "border-stone-200 bg-white text-stone-700",
                    )}
                  >
                    {t(lang, `paymentMethod_${method}`)}
                  </button>
                ))}
              </div>
            </div>

            {paymentMethod === "cash" || paymentMethod === "credit" ? (
              <div className="mt-4">
                <p className="text-base font-semibold text-slate-800">
                  {paymentMethod === "cash" ? t(lang, "paymentCashReceivedLabel") : t(lang, "paymentCashLabel")}
                </p>
                <button
                  type="button"
                  onClick={() => onCheckoutAmountField("cash")}
                  className={clsx(
                    "mt-2 flex min-h-[52px] w-full items-center justify-end rounded-2xl border-2 px-4 py-3 text-xl font-black",
                    checkoutAmountField === "cash"
                      ? "border-waka-500 bg-waka-50 text-slate-900"
                      : "border-slate-200 bg-white text-slate-900",
                  )}
                >
                  UGX {(cashInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                </button>
              </div>
            ) : null}

            {paymentMethod === "credit" ? (
              <div className="mt-4">
                <p className="text-base font-semibold text-slate-800">{t(lang, "paymentMobileMoneyLabel")}</p>
                <button
                  type="button"
                  onClick={() => onCheckoutAmountField("mobile")}
                  className={clsx(
                    "mt-2 flex min-h-[52px] w-full items-center justify-end rounded-2xl border-2 px-4 py-3 text-xl font-black",
                    checkoutAmountField === "mobile"
                      ? "border-waka-500 bg-waka-50 text-slate-900"
                      : "border-slate-200 bg-white text-slate-900",
                  )}
                >
                  UGX {(mobileMoneyInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                </button>
              </div>
            ) : null}

            {(paymentMethod === "cash" || paymentMethod === "credit") && (
              <div className="mt-4">
                <Numpad allowDecimal={false} onDigit={onAppendCheckoutDigit} onClear={onClearCheckoutAmount} />
              </div>
            )}

            {(paymentMethod === "cash" || paymentMethod === "credit") && (cashInput || changeDue > 0) ? (
              <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-base font-black text-emerald-900">
                {t(lang, "paymentChangeDueLabel")}: UGX {changeDue.toLocaleString()}
              </p>
            ) : null}

            {paymentMethod === "credit" ? (
              <>
                <p className="mt-3 rounded-xl bg-amber-100 px-4 py-2 text-sm font-bold text-amber-900">
                  {t(lang, "paymentRemainingBalance")}: UGX {computedDebt.toLocaleString()}
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-base font-semibold text-slate-800">
                    {t(lang, "paymentDebtNameLabel")}
                    <input
                      value={saleCustomerName}
                      onChange={(e) => onSaleCustomerName(e.target.value)}
                      className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg font-semibold"
                      placeholder={t(lang, "paymentDebtNamePlaceholder")}
                    />
                  </label>
                  <label className="block text-base font-semibold text-slate-800">
                    {t(lang, "paymentDebtPhoneLabel")}
                    <input
                      value={saleCustomerPhone}
                      onChange={(e) => onSaleCustomerPhone(e.target.value)}
                      className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg font-semibold"
                      placeholder={t(lang, "personPhonePh")}
                      inputMode="tel"
                    />
                  </label>
                </div>
                {customers.length > 0 ? (
                  <label className="mt-4 block text-base font-semibold text-slate-800">
                    {t(lang, "paymentPickExistingDebt")}
                    <select
                      ref={customerSelectRef}
                      value={saleCustomerId}
                      onChange={(e) => onSaleCustomerId(e.target.value)}
                      className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-4 text-lg font-medium"
                    >
                      <option value="">{t(lang, "paymentNoNamedCustomer")}</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.debtBalanceUgx > 0
                            ? ` — ${t(lang, "debtBalanceShort")} UGX ${c.debtBalanceUgx.toLocaleString()}`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            ) : null}
            <div aria-hidden className="h-4 shrink-0" />
          </>
        )}
      </div>

      <footer
        className={clsx(
          "shrink-0 border-t border-waka-200 bg-waka-50 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]",
          isSidebar ? "rounded-b-[1.35rem] pb-3" : "pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
        )}
      >
        {canSavePending && paymentMethod !== "credit" && !emptyCart ? (
          <button
            type="button"
            onClick={onSavePending}
            className="mb-2 min-h-[48px] w-full rounded-2xl border-2 border-amber-300 bg-amber-50 text-lg font-black text-amber-950 active:bg-amber-100"
          >
            {savePendingLabel}
          </button>
        ) : null}
        <button
          ref={saveButtonRef}
          type="button"
          onClick={onFinishSale}
          disabled={emptyCart}
          className="min-h-[56px] w-full rounded-3xl bg-waka-600 py-4 text-2xl font-black text-white shadow-lg active:bg-waka-700 disabled:opacity-40"
        >
          {saveSaleLabel}
        </button>
      </footer>
    </div>
  );
}
