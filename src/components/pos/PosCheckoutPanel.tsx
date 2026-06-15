import { memo, type ReactNode, type RefObject } from "react";
import clsx from "clsx";
import { Check } from "lucide-react";
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
  compact = false,
}: {
  onDigit: (d: string) => void;
  onClear: () => void;
  allowDecimal: boolean;
  compact?: boolean;
}) {
  const row4 = allowDecimal ? [".", "0", "⌫"] : ["0", "⌫", "C"];
  const keyClass = compact
    ? "min-h-[42px] rounded-xl bg-slate-100 py-1.5 text-lg font-semibold text-slate-900 active:bg-slate-200"
    : "min-h-[56px] rounded-2xl bg-slate-100 py-3 text-2xl font-semibold text-slate-900 active:bg-slate-200 active:brightness-95 motion-reduce:active:brightness-100";

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className={clsx("grid grid-cols-3", compact ? "gap-1.5" : "gap-2")}>
        {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
          <button key={k} type="button" onClick={() => onDigit(k)} className={keyClass}>
            {k}
          </button>
        ))}
      </div>
      <div className={clsx("grid grid-cols-3", compact ? "gap-1.5" : "gap-2")}>
        {row4.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              if (k === "C") onClear();
              else if (k === "⌫") onDigit("back");
              else onDigit(k);
            }}
            className={keyClass}
          >
            {k}
          </button>
        ))}
      </div>
      {allowDecimal && !compact ? (
        <button
          type="button"
          onClick={onClear}
          className="w-full min-h-[52px] rounded-2xl bg-amber-100 py-3 text-lg font-bold text-amber-900 active:bg-amber-200"
        >
          C
        </button>
      ) : null}
    </div>
  );
});

  );
});

/** Italian-style numpad with clear + confirm on the right — always visible on mobile checkout. */
const CheckoutNumpadDock = memo(function CheckoutNumpadDock({
  onDigit,
  onClear,
  onSave,
  saveLabel,
  saveDisabled,
  saveButtonRef,
}: {
  onDigit: (d: string) => void;
  onClear: () => void;
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  saveButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const keyClass =
    "min-h-[40px] rounded-lg bg-slate-100 py-1 text-lg font-semibold text-slate-900 active:bg-slate-200";

  return (
    <div className="grid grid-cols-[1fr_4.25rem] gap-1.5">
      <div className="space-y-1.5">
        <div className="grid grid-cols-3 gap-1.5">
          {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
            <button key={k} type="button" onClick={() => onDigit(k)} className={keyClass}>
              {k}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {(["00", "0", "⌫"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                if (k === "⌫") onDigit("back");
                else onDigit(k);
              }}
              className={keyClass}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-1.5">
        <button
          type="button"
          onClick={onClear}
          className="min-h-[40px] rounded-lg bg-rose-500 text-lg font-black text-white active:bg-rose-600"
        >
          C
        </button>
        <button
          ref={saveButtonRef}
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg bg-emerald-600 px-1 py-2 text-xs font-black leading-tight text-white shadow-md active:bg-emerald-700 disabled:opacity-40"
        >
          <Check className="h-6 w-6 stroke-[3]" aria-hidden />
          <span className="text-center">{saveLabel}</span>
        </button>
      </div>
    </div>
  );
});

type PaymentBlockProps = {
  lang: Language;
  compact: boolean;
  dockMode?: boolean;
  hideNumpad?: boolean;
  draftPayable: number;
  checkoutTotals: DraftCheckoutTotals;
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
  customerSelectRef?: RefObject<HTMLSelectElement | null>;
  onPaymentMethod: (method: PaymentMethod) => void;
  onCheckoutAmountField: (field: CheckoutAmountField) => void;
  onAppendCheckoutDigit: (d: string) => void;
  onClearCheckoutAmount: () => void;
  onSaleCustomerId: (id: string) => void;
  onSaleCustomerName: (name: string) => void;
  onSaleCustomerPhone: (phone: string) => void;
};

function PaymentBlock({
  lang,
  compact,
  dockMode = false,
  hideNumpad = false,
  draftPayable,
  checkoutTotals,
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
  customerSelectRef,
  onPaymentMethod,
  onCheckoutAmountField,
  onAppendCheckoutDigit,
  onClearCheckoutAmount,
  onSaleCustomerId,
  onSaleCustomerName,
  onSaleCustomerPhone,
}: PaymentBlockProps) {
  const amountBtnClass = compact
    ? "mt-1.5 flex min-h-[40px] w-full items-center justify-end rounded-xl border-2 px-3 py-2 text-lg font-black"
    : "mt-2 flex min-h-[52px] w-full items-center justify-end rounded-2xl border-2 px-4 py-3 text-xl font-black";

  return (
    <>
      {!dockMode ? (
        <p
          className={clsx(
            "font-black text-slate-900",
            compact ? "flex items-baseline justify-between gap-2 text-lg" : "text-3xl",
          )}
        >
          <span className={compact ? "text-sm font-bold text-stone-600" : undefined}>
            {checkoutTotals.cartDiscountUgx > 0 ? t(lang, "payableTotalLabel") : t(lang, "totalLabel")}
          </span>
          <span className="text-waka-700">UGX {draftPayable.toLocaleString()}</span>
        </p>
      ) : null}

      <div className={dockMode ? "mt-0" : compact ? "mt-2" : "mt-4"}>
        <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">
          {t(lang, "paymentMethodLabel")}
        </p>
        <div className={clsx("mt-1.5 grid gap-1.5", dockMode || compact ? "grid-cols-4" : "grid-cols-2 gap-2 mt-2")}>
          {checkoutMethods.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => {
                onPaymentMethod(method);
                if (method === "cash" || method === "credit") onCheckoutAmountField("cash");
              }}
              className={clsx(
                "rounded-xl border font-black leading-tight",
                dockMode || compact ? "min-h-[34px] px-1 text-[10px]" : "min-h-[48px] rounded-2xl text-sm",
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
        <div className={dockMode ? "mt-1.5" : compact ? "mt-2" : "mt-4"}>
          <p
            className={
              dockMode
                ? "text-[10px] font-semibold text-slate-700"
                : compact
                  ? "text-xs font-semibold text-slate-800"
                  : "text-base font-semibold text-slate-800"
            }
          >
            {paymentMethod === "cash" ? t(lang, "paymentCashReceivedLabel") : t(lang, "paymentCashLabel")}
          </p>
          <button
            type="button"
            onClick={() => onCheckoutAmountField("cash")}
            className={clsx(
              amountBtnClass,
              dockMode && "mt-1 min-h-[36px] rounded-lg px-2.5 py-1.5 text-base",
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
        <div className={compact ? "mt-2" : "mt-4"}>
          <p className={compact ? "text-xs font-semibold text-slate-800" : "text-base font-semibold text-slate-800"}>
            {t(lang, "paymentMobileMoneyLabel")}
          </p>
          <button
            type="button"
            onClick={() => onCheckoutAmountField("mobile")}
            className={clsx(
              amountBtnClass,
              checkoutAmountField === "mobile"
                ? "border-waka-500 bg-waka-50 text-slate-900"
                : "border-slate-200 bg-white text-slate-900",
            )}
          >
            UGX {(mobileMoneyInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
          </button>
        </div>
      ) : null}

      {(paymentMethod === "cash" || paymentMethod === "credit") && !hideNumpad && (
        <div className={compact ? "mt-2" : "mt-4"}>
          <Numpad
            compact={compact}
            allowDecimal={false}
            onDigit={onAppendCheckoutDigit}
            onClear={onClearCheckoutAmount}
          />
        </div>
      )}

      {(paymentMethod === "cash" || paymentMethod === "credit") && (cashInput || changeDue > 0) ? (
        <p
          className={clsx(
            "font-black text-emerald-900",
            dockMode
              ? "mt-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px]"
              : compact
                ? "mt-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm"
                : "mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-base",
          )}
        >
          {t(lang, "paymentChangeDueLabel")}: UGX {changeDue.toLocaleString()}
        </p>
      ) : null}

      {paymentMethod === "credit" ? (
        <>
          <p className={clsx("rounded-xl bg-amber-100 font-bold text-amber-900", dockMode ? "mt-1 px-2 py-1 text-[10px]" : compact ? "mt-2 px-3 py-1.5 text-xs" : "mt-3 px-4 py-2 text-sm")}>
            {t(lang, "paymentRemainingBalance")}: UGX {computedDebt.toLocaleString()}
          </p>
          <div className={clsx("grid gap-2", dockMode ? "mt-1 max-h-[18dvh] overflow-y-auto" : compact ? "mt-2" : "mt-4 sm:grid-cols-2 sm:gap-3")}>
            <label className={clsx("block font-semibold text-slate-800", compact ? "text-xs" : "text-base")}>
              {t(lang, "paymentDebtNameLabel")}
              <input
                value={saleCustomerName}
                onChange={(e) => onSaleCustomerName(e.target.value)}
                className={clsx(
                  "mt-1 w-full rounded-xl border-2 border-slate-200 bg-white font-semibold",
                  compact ? "min-h-[40px] px-3 py-2 text-sm" : "mt-2 min-h-[52px] rounded-2xl px-4 py-3 text-lg",
                )}
                placeholder={t(lang, "paymentDebtNamePlaceholder")}
              />
            </label>
            <label className={clsx("block font-semibold text-slate-800", compact ? "text-xs" : "text-base")}>
              {t(lang, "paymentDebtPhoneLabel")}
              <input
                value={saleCustomerPhone}
                onChange={(e) => onSaleCustomerPhone(e.target.value)}
                className={clsx(
                  "mt-1 w-full rounded-xl border-2 border-slate-200 bg-white font-semibold",
                  compact ? "min-h-[40px] px-3 py-2 text-sm" : "mt-2 min-h-[52px] rounded-2xl px-4 py-3 text-lg",
                )}
                placeholder={t(lang, "personPhonePh")}
                inputMode="tel"
              />
            </label>
          </div>
          {customers.length > 0 ? (
            <label className={clsx("block font-semibold text-slate-800", compact ? "mt-2 text-xs" : "mt-4 text-base")}>
              {t(lang, "paymentPickExistingDebt")}
              <select
                ref={customerSelectRef}
                value={saleCustomerId}
                onChange={(e) => onSaleCustomerId(e.target.value)}
                className={clsx(
                  "mt-1 w-full rounded-xl border-2 border-slate-200 bg-white font-medium",
                  compact ? "min-h-[40px] px-3 py-2 text-sm" : "mt-2 min-h-[52px] rounded-2xl px-4 py-4 text-lg",
                )}
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
    </>
  );
}

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

function CartScrollBody({
  lang,
  compact,
  draftLines,
  draftCartStats,
  checkoutTotals,
  draftPayable,
  draftDiscountTotal,
  productById,
  onIncrement,
  onDecrement,
  onQtyTap,
  onLineDiscount,
  onRemoveLine,
  onOpenCartDiscount,
}: {
  lang: Language;
  compact: boolean;
  draftLines: SaleLine[];
  draftCartStats: DraftCartStats;
  checkoutTotals: DraftCheckoutTotals;
  draftPayable: number;
  draftDiscountTotal: number;
  productById: Map<string, Product>;
  onIncrement: (line: SaleLine) => void;
  onDecrement: (line: SaleLine) => void;
  onQtyTap: (line: SaleLine) => void;
  onLineDiscount: (line: SaleLine) => void;
  onRemoveLine: (productId: string) => void;
  onOpenCartDiscount: () => void;
}): ReactNode {
  const hasDiscountBreakdown = draftDiscountTotal > 0 || checkoutTotals.cartDiscountUgx > 0;

  return (
    <>
      <DraftCartSummary
        lang={lang}
        stats={draftCartStats}
        payableUgx={draftPayable}
        cartDiscountUgx={checkoutTotals.cartDiscountUgx}
        compact={compact}
      />
      <ul className={clsx("rounded-2xl border border-waka-200 bg-white shadow-sm", compact ? "mt-2 space-y-1.5 p-2" : "mt-3 space-y-2 p-3")}>
        {draftLines.map((line) => (
          <DraftCartLineRow
            key={line.productId}
            lang={lang}
            line={line}
            product={productById.get(line.productId)}
            compact={compact}
            onIncrement={() => onIncrement(line)}
            onDecrement={() => onDecrement(line)}
            onQtyTap={() => onQtyTap(line)}
            onDiscount={() => onLineDiscount(line)}
            onRemove={() => onRemoveLine(line.productId)}
          />
        ))}
      </ul>
      {draftDiscountTotal > 0 && !compact ? (
        <p className="mt-2 text-sm font-bold text-amber-800">
          {t(lang, "draftLineDiscountTotal")}: UGX {draftDiscountTotal.toLocaleString()}
        </p>
      ) : null}
      <div
        className={clsx(
          "flex items-center justify-between gap-2 rounded-xl border border-waka-200 bg-waka-50/80",
          compact ? "mt-2 px-2.5 py-2" : "mt-4 rounded-2xl p-3",
        )}
      >
        <p className={clsx("font-black text-slate-800", compact ? "text-xs" : "text-sm")}>
          {t(lang, "cartDiscountApplied")}
        </p>
        <button
          type="button"
          onClick={onOpenCartDiscount}
          className={clsx(
            "shrink-0 rounded-xl border-2 border-waka-400 bg-white font-black text-waka-900 active:bg-waka-100",
            compact ? "min-h-[36px] px-3 text-xs" : "min-h-[44px] rounded-2xl px-4 text-sm",
          )}
        >
          {t(lang, "cartDiscountBtn")}
        </button>
      </div>
      {checkoutTotals.cartDiscountUgx > 0 && !compact ? (
        <p className="mt-2 text-sm font-bold text-emerald-900">
          − UGX {checkoutTotals.cartDiscountUgx.toLocaleString()}
        </p>
      ) : null}
      {hasDiscountBreakdown ? (
        <div
          className={clsx(
            "space-y-1 rounded-xl border border-slate-200 bg-slate-50/80 font-semibold text-slate-700",
            compact ? "mt-2 p-2 text-xs" : "mt-3 rounded-2xl p-3 text-sm",
          )}
        >
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
          <p className="flex justify-between gap-2 border-t border-slate-200 pt-1 font-black text-slate-900">
            <span>{t(lang, "checkoutFinalTotalLabel")}</span>
            <span>UGX {draftPayable.toLocaleString()}</span>
          </p>
        </div>
      ) : null}
    </>
  );
}

function CartDockBody({
  lang,
  draftLines,
  draftCartStats,
  draftPayable,
  checkoutTotals,
  productById,
  onIncrement,
  onDecrement,
  onQtyTap,
  onLineDiscount,
  onRemoveLine,
  onOpenCartDiscount,
}: {
  lang: Language;
  draftLines: SaleLine[];
  draftCartStats: DraftCartStats;
  draftPayable: number;
  checkoutTotals: DraftCheckoutTotals;
  productById: Map<string, Product>;
  onIncrement: (line: SaleLine) => void;
  onDecrement: (line: SaleLine) => void;
  onQtyTap: (line: SaleLine) => void;
  onLineDiscount: (line: SaleLine) => void;
  onRemoveLine: (productId: string) => void;
  onOpenCartDiscount: () => void;
}): ReactNode {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <DraftCartSummary
            lang={lang}
            stats={draftCartStats}
            payableUgx={draftPayable}
            cartDiscountUgx={checkoutTotals.cartDiscountUgx}
            dock
          />
        </div>
        <button
          type="button"
          onClick={onOpenCartDiscount}
          className="shrink-0 rounded-lg border border-waka-300 bg-white px-2 py-1 text-[10px] font-black text-waka-900 active:bg-waka-50"
        >
          {t(lang, "cartDiscountBtn")}
        </button>
      </div>
      <ul className="mt-1.5 rounded-lg border border-waka-200 bg-white px-2 py-0.5 shadow-sm">
        {draftLines.map((line) => (
          <DraftCartLineRow
            key={line.productId}
            lang={lang}
            line={line}
            product={productById.get(line.productId)}
            dock
            onIncrement={() => onIncrement(line)}
            onDecrement={() => onDecrement(line)}
            onQtyTap={() => onQtyTap(line)}
            onDiscount={() => onLineDiscount(line)}
            onRemove={() => onRemoveLine(line.productId)}
          />
        ))}
      </ul>
    </>
  );
}

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
  const isCompact = !isSidebar;
  const emptyCart = draftLines.length === 0;

  const paymentProps: PaymentBlockProps = {
    lang,
    compact: isCompact,
    dockMode: isCompact,
    hideNumpad: isCompact,
    draftPayable,
    checkoutTotals,
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
    customerSelectRef,
    onPaymentMethod,
    onCheckoutAmountField,
    onAppendCheckoutDigit,
    onClearCheckoutAmount,
    onSaleCustomerId,
    onSaleCustomerName,
    onSaleCustomerPhone,
  };

  const cartBodyProps = {
    lang,
    compact: isCompact,
    draftLines,
    draftCartStats,
    checkoutTotals,
    draftPayable,
    draftDiscountTotal,
    productById,
    onIncrement,
    onDecrement,
    onQtyTap,
    onLineDiscount,
    onRemoveLine,
    onOpenCartDiscount,
  };

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
          "flex shrink-0 items-center gap-2 border-b border-waka-200 bg-waka-50",
          isCompact ? "px-3 py-2" : "px-3 py-3",
          isSidebar && "rounded-t-[1.35rem]",
        )}
      >
        <button
          type="button"
          onClick={onClearDraft}
          disabled={emptyCart}
          className={clsx(
            "shrink-0 rounded-full border border-slate-200 bg-white font-semibold text-slate-600 shadow-sm active:bg-slate-50 disabled:opacity-40",
            isCompact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
          )}
        >
          {clearSaleLabel}
        </button>
        <h2
          id="pos-checkout-title"
          className={clsx(
            "min-w-0 flex-1 truncate text-center font-black text-waka-950",
            isCompact ? "text-base" : "text-lg",
          )}
        >
          {saleTitle}
        </h2>
        {!isSidebar && onMinimize ? (
          <button
            type="button"
            onClick={onMinimize}
            className={clsx(
              "shrink-0 rounded-full border border-waka-300 bg-white font-bold text-waka-900 shadow-sm active:bg-waka-50",
              isCompact ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
            )}
          >
            {t(lang, "posAddMoreItems")}
          </button>
        ) : (
          <span className={clsx("shrink-0", isCompact ? "w-12" : "w-[4.5rem]")} aria-hidden />
        )}
      </header>

      {checkoutBlockMessage ? (
        <div
          className={clsx(
            "mx-3 shrink-0 rounded-xl bg-red-600 text-center font-bold text-white shadow-sm",
            isCompact ? "mt-1.5 px-3 py-2 text-xs" : "mt-2 px-4 py-3 text-sm",
          )}
          role="alert"
        >
          {checkoutBlockMessage}
        </div>
      ) : null}

      {emptyCart ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="py-8 text-center text-sm font-semibold text-slate-500">{t(lang, "posCartEmptyHint")}</p>
        </div>
      ) : isCompact ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="max-h-[min(28dvh,11rem)] min-h-0 shrink-0 overflow-y-auto overscroll-y-contain border-b border-waka-200 px-3 py-2 [-webkit-overflow-scrolling:touch]">
            <CartDockBody
              lang={lang}
              draftLines={draftLines}
              draftCartStats={draftCartStats}
              draftPayable={draftPayable}
              checkoutTotals={checkoutTotals}
              productById={productById}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
              onQtyTap={onQtyTap}
              onLineDiscount={onLineDiscount}
              onRemoveLine={onRemoveLine}
              onOpenCartDiscount={onOpenCartDiscount}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pt-2 [-webkit-overflow-scrolling:touch]">
            <PaymentBlock {...paymentProps} />
          </div>
          <div className="mt-auto shrink-0 border-t border-waka-200 bg-white px-3 py-2 pb-[max(0.375rem,env(safe-area-inset-bottom,0px))] shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
            {canSavePending && paymentMethod !== "credit" ? (
              <button
                type="button"
                onClick={onSavePending}
                className="mb-1.5 w-full rounded-xl border border-amber-300 bg-amber-50 py-1.5 text-xs font-black text-amber-950 active:bg-amber-100"
              >
                {savePendingLabel}
              </button>
            ) : null}
            {paymentMethod === "cash" || paymentMethod === "credit" ? (
              <CheckoutNumpadDock
                onDigit={onAppendCheckoutDigit}
                onClear={onClearCheckoutAmount}
                onSave={onFinishSale}
                saveLabel={saveSaleLabel}
                saveDisabled={emptyCart}
                saveButtonRef={saveButtonRef}
              />
            ) : (
              <button
                ref={saveButtonRef}
                type="button"
                onClick={onFinishSale}
                disabled={emptyCart}
                className="w-full rounded-xl bg-emerald-600 py-3.5 text-lg font-black text-white shadow-lg active:bg-emerald-700 disabled:opacity-40"
              >
                {saveSaleLabel}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4 lg:p-3 [-webkit-overflow-scrolling:touch]">
          <CartScrollBody {...cartBodyProps} />
          <div className="mt-4">
            <PaymentBlock {...paymentProps} />
          </div>
          <div aria-hidden className="h-4 shrink-0" />
        </div>
      )}

      <footer
        className={clsx(
          "shrink-0 border-t border-waka-200 bg-waka-50 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]",
          isCompact ? "hidden" : "px-4 py-3",
          isSidebar && "rounded-b-[1.35rem] pb-3",
        )}
      >
        {canSavePending && paymentMethod !== "credit" && !emptyCart ? (
          <button
            type="button"
            onClick={onSavePending}
            className={clsx(
              "mb-1.5 w-full rounded-2xl border-2 border-amber-300 bg-amber-50 font-black text-amber-950 active:bg-amber-100",
              isCompact ? "min-h-[40px] text-sm" : "mb-2 min-h-[48px] text-lg",
            )}
          >
            {savePendingLabel}
          </button>
        ) : null}
        <button
          ref={saveButtonRef}
          type="button"
          onClick={onFinishSale}
          disabled={emptyCart}
          className={clsx(
            "w-full rounded-2xl bg-waka-600 font-black text-white shadow-lg active:bg-waka-700 disabled:opacity-40",
            isCompact ? "min-h-[44px] py-2.5 text-lg" : "min-h-[56px] rounded-3xl py-4 text-2xl",
          )}
        >
          {saveSaleLabel}
        </button>
      </footer>
    </div>
  );
}
