import { memo, useEffect, useState, type ReactNode, type RefObject } from "react";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
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
  enterprise = false,
}: {
  onDigit: (d: string) => void;
  onClear: () => void;
  allowDecimal: boolean;
  compact?: boolean;
  enterprise?: boolean;
}) {
  const row4 = enterprise
    ? (["0", "00", "⌫"] as const)
    : allowDecimal
      ? [".", "0", "⌫"]
      : ["0", "⌫", "C"];
  const keyClass = enterprise
    ? "min-h-[36px] rounded-lg bg-slate-100 py-1 text-base font-semibold text-slate-900 active:bg-slate-200"
    : compact
      ? "min-h-[44px] rounded-xl bg-slate-100 py-1.5 text-lg font-semibold text-slate-900 active:bg-slate-200"
      : "min-h-[56px] rounded-2xl bg-slate-100 py-3 text-2xl font-semibold text-slate-900 active:bg-slate-200 active:brightness-95 motion-reduce:active:brightness-100";

  return (
    <div className={enterprise ? "space-y-1" : compact ? "space-y-1.5" : "space-y-2"}>
      <div className={clsx("grid grid-cols-3", enterprise ? "gap-1" : compact ? "gap-1.5" : "gap-2")}>
        {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
          <button key={k} type="button" onClick={() => onDigit(k)} className={keyClass}>
            {k}
          </button>
        ))}
      </div>
      <div className={clsx("grid grid-cols-3", enterprise ? "gap-1" : compact ? "gap-1.5" : "gap-2")}>
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
      {enterprise ? (
        <button
          type="button"
          onClick={onClear}
          className="w-full min-h-[32px] rounded-lg bg-amber-100 py-1 text-sm font-bold text-amber-900 active:bg-amber-200"
        >
          C
        </button>
      ) : allowDecimal && !compact ? (
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

/** Italian-style numpad with clear + confirm on the right — mobile checkout & desktop sidebar. */
export const CheckoutNumpadDock = memo(function CheckoutNumpadDock({
  onDigit,
  onClear,
  onSave,
  saveLabel,
  saveDisabled,
  saveButtonRef,
  sidebar = false,
}: {
  onDigit: (d: string) => void;
  onClear: () => void;
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  saveButtonRef?: RefObject<HTMLButtonElement | null>;
  sidebar?: boolean;
}) {
  const keyClass = sidebar
    ? "min-h-[44px] rounded-lg bg-slate-100 py-1 text-xl font-bold text-slate-900 active:bg-slate-200"
    : "min-h-[52px] rounded-xl bg-slate-100 py-1.5 text-2xl font-bold text-slate-900 active:bg-slate-200";

  return (
    <div className={clsx("grid gap-2", sidebar ? "grid-cols-[1fr_4.25rem]" : "grid-cols-[1fr_5rem]")}>
      <div className={clsx("flex min-h-0 flex-col", sidebar ? "gap-1.5" : "gap-2")}>
        <div className={clsx("grid grid-cols-3", sidebar ? "gap-1.5" : "gap-2")}>
          {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
            <button key={k} type="button" onClick={() => onDigit(k)} className={keyClass}>
              {k}
            </button>
          ))}
        </div>
        <div className={clsx("grid grid-cols-3", sidebar ? "gap-1.5" : "gap-2")}>
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
      <div className="flex min-h-0 flex-col gap-2">
        <button
          type="button"
          onClick={onClear}
          className={clsx(
            "rounded-xl bg-rose-500 font-black text-white active:bg-rose-600",
            sidebar ? "min-h-[44px] text-lg" : "min-h-[52px] text-xl",
          )}
        >
          C
        </button>
        <button
          ref={saveButtonRef}
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          className={clsx(
            "flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-emerald-600 px-1 py-2 font-black leading-tight text-white shadow-md active:bg-emerald-700 disabled:opacity-40",
            sidebar ? "text-xs" : "text-sm",
          )}
        >
          <Check className={clsx("stroke-[3]", sidebar ? "h-6 w-6" : "h-7 w-7")} aria-hidden />
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
  enterprise?: boolean;
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
  hideCreditDockPanel?: boolean;
  /** Desktop sidebar with external catalog dock — tighter payment strip. */
  sidebarCompact?: boolean;
};

function PaymentBlock({
  lang,
  compact,
  dockMode = false,
  hideNumpad = false,
  enterprise = false,
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
  hideCreditDockPanel = false,
  sidebarCompact = false,
}: PaymentBlockProps) {
  const amountBtnClass = enterprise
    ? "mt-1 flex min-h-[40px] w-full items-center justify-end rounded-lg border-2 px-3 py-1.5 text-lg font-black"
    : compact
      ? "mt-1.5 flex min-h-[44px] w-full items-center justify-end rounded-xl border-2 px-3 py-2 text-lg font-black"
      : "mt-2 flex min-h-[52px] w-full items-center justify-end rounded-2xl border-2 px-4 py-3 text-xl font-black";

  return (
    <>
      {!dockMode ? (
        <p
          className={clsx(
            "font-black text-slate-900",
            enterprise
              ? "flex items-baseline justify-between gap-2 text-base"
              : compact
                ? "flex items-baseline justify-between gap-2 text-lg"
                : "text-3xl",
          )}
        >
          <span className={compact ? "text-sm font-bold text-stone-600" : undefined}>
            {checkoutTotals.cartDiscountUgx > 0 ? t(lang, "payableTotalLabel") : t(lang, "totalLabel")}
          </span>
          <span className="text-waka-700">UGX {draftPayable.toLocaleString()}</span>
        </p>
      ) : null}

      <div className={dockMode ? "mt-0" : compact ? "mt-2" : "mt-4"}>
        <p
          className={clsx(
            "font-black uppercase tracking-wide text-stone-600",
            sidebarCompact ? "text-[10px]" : "text-xs sm:text-sm",
          )}
        >
          {t(lang, "paymentMethodLabel")}
        </p>
        <div
          className={clsx(
            "grid gap-1.5",
            dockMode || compact ? "grid-cols-4 max-[359px]:grid-cols-2" : "mt-2 grid-cols-2 gap-2",
            !sidebarCompact && (dockMode || compact) && "mt-2 gap-2",
          )}
        >
          {checkoutMethods.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => {
                onPaymentMethod(method);
                if (method === "cash" || method === "credit") onCheckoutAmountField("cash");
              }}
              className={clsx(
                "rounded-lg border font-black leading-snug",
                sidebarCompact
                  ? "min-h-[34px] px-0.5 text-[11px]"
                  : dockMode
                    ? "min-h-[44px] rounded-xl px-1 text-sm"
                    : compact
                      ? "min-h-[44px] px-1.5 text-xs sm:text-sm"
                      : "min-h-[48px] rounded-2xl text-sm",
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

      {paymentMethod === "credit" && dockMode && hideCreditDockPanel ? (
        <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-900">
          {t(lang, "posDesktopCreditPanelHint")}
        </p>
      ) : null}

      {paymentMethod === "cash" || (paymentMethod === "credit" && !dockMode) ? (
        <div className={sidebarCompact ? "mt-1.5" : dockMode ? "mt-2" : compact ? "mt-2" : "mt-4"}>
          <p
            className={
              sidebarCompact
                ? "text-[10px] font-semibold text-slate-800"
                : dockMode
                  ? "text-sm font-semibold text-slate-800"
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
              sidebarCompact && "mt-1 min-h-[36px] rounded-lg px-2 py-1 text-base",
              dockMode && !sidebarCompact && "mt-1.5 min-h-[48px] rounded-xl px-3 py-2 text-xl",
              checkoutAmountField === "cash"
                ? "border-waka-500 bg-waka-50 text-slate-900"
                : "border-slate-200 bg-white text-slate-900",
            )}
          >
            UGX {(cashInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
          </button>
        </div>
      ) : null}

      {paymentMethod === "credit" && !dockMode ? (
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

      {paymentMethod === "credit" && dockMode && !hideCreditDockPanel ? (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <p className="text-[11px] font-semibold leading-tight text-slate-800">{t(lang, "paymentCashLabel")}</p>
              <button
                type="button"
                onClick={() => onCheckoutAmountField("cash")}
                className={clsx(
                  "mt-1 flex min-h-[44px] w-full items-center justify-end rounded-xl border-2 px-2 py-1.5 text-base font-black",
                  checkoutAmountField === "cash"
                    ? "border-waka-500 bg-waka-50 text-slate-900"
                    : "border-slate-200 bg-white text-slate-900",
                )}
              >
                UGX {(cashInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
              </button>
            </div>
            <div>
              <p className="text-[11px] font-semibold leading-tight text-slate-800">{t(lang, "paymentMobileMoneyLabel")}</p>
              <button
                type="button"
                onClick={() => onCheckoutAmountField("mobile")}
                className={clsx(
                  "mt-1 flex min-h-[44px] w-full items-center justify-end rounded-xl border-2 px-2 py-1.5 text-base font-black",
                  checkoutAmountField === "mobile"
                    ? "border-waka-500 bg-waka-50 text-slate-900"
                    : "border-slate-200 bg-white text-slate-900",
                )}
              >
                UGX {(mobileMoneyInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
              </button>
            </div>
          </div>
          <p className="mt-1.5 rounded-md bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900">
            {t(lang, "paymentRemainingBalance")}: UGX {computedDebt.toLocaleString()}
          </p>
          <details className="group mt-1.5 rounded-xl border border-slate-200 bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-bold text-slate-800 [&::-webkit-details-marker]:hidden">
              <span>{t(lang, "paymentCreditCustomerDetails")}</span>
              <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-amber-900">
                <span className="truncate">
                  {saleCustomerName.trim() || t(lang, "paymentCreditCustomerDetailsTap")}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden />
              </span>
            </summary>
            <div className="space-y-2 border-t border-slate-100 px-3 py-2">
              <label className="block text-xs font-semibold text-slate-800">
                {t(lang, "paymentDebtNameLabel")}
                <input
                  value={saleCustomerName}
                  onChange={(e) => onSaleCustomerName(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
                  placeholder={t(lang, "paymentDebtNamePlaceholder")}
                />
              </label>
              <label className="block text-xs font-semibold text-slate-800">
                {t(lang, "paymentDebtPhoneLabel")}
                <input
                  value={saleCustomerPhone}
                  onChange={(e) => onSaleCustomerPhone(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold"
                  placeholder={t(lang, "personPhonePh")}
                  inputMode="tel"
                />
              </label>
              {customers.length > 0 ? (
                <label className="block text-xs font-semibold text-slate-800">
                  {t(lang, "paymentPickExistingDebt")}
                  <select
                    ref={customerSelectRef}
                    value={saleCustomerId}
                    onChange={(e) => onSaleCustomerId(e.target.value)}
                    className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-medium"
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
            </div>
          </details>
        </>
      ) : null}

      {(paymentMethod === "cash" || paymentMethod === "credit") && !hideNumpad && (
        <div className={enterprise ? "mt-1.5" : compact ? "mt-2" : "mt-4"}>
          <Numpad
            compact={compact}
            enterprise={enterprise}
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
            sidebarCompact
              ? "mt-1 rounded px-2 py-0.5 text-[10px] font-bold"
              : dockMode
                ? "mt-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-sm"
                : compact
                  ? "mt-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-sm"
                  : "mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-base",
            !sidebarCompact && dockMode && "bg-emerald-50",
            !sidebarCompact && compact && "bg-emerald-50",
            !sidebarCompact && !dockMode && !compact && "bg-emerald-50",
          )}
        >
          {t(lang, "paymentChangeDueLabel")}: UGX {changeDue.toLocaleString()}
        </p>
      ) : null}

      {paymentMethod === "credit" && !dockMode ? (
        <>
          <p className={clsx("rounded-xl bg-amber-100 font-bold text-amber-900", compact ? "mt-2 px-3 py-1.5 text-xs" : "mt-3 px-4 py-2 text-sm")}>
            {t(lang, "paymentRemainingBalance")}: UGX {computedDebt.toLocaleString()}
          </p>
          <div className={clsx("grid gap-2", compact ? "mt-2" : "mt-4 sm:grid-cols-2 sm:gap-3")}>
            <label className={clsx("block font-semibold text-slate-800", compact ? "text-xs" : "text-base")}>
              {t(lang, "paymentDebtNameLabel")}
              <input
                value={saleCustomerName}
                onChange={(e) => onSaleCustomerName(e.target.value)}
                className={clsx(
                  "mt-1 w-full rounded-xl border-2 border-slate-200 bg-white font-semibold",
                  compact ? "min-h-[44px] px-3 py-2 text-sm" : "mt-2 min-h-[52px] rounded-2xl px-4 py-3 text-lg",
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
                  compact ? "min-h-[44px] px-3 py-2 text-sm" : "mt-2 min-h-[52px] rounded-2xl px-4 py-3 text-lg",
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
                  compact ? "min-h-[44px] px-3 py-2 text-sm" : "mt-2 min-h-[52px] rounded-2xl px-4 py-4 text-lg",
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

/** Pay-later fields for the desktop catalog column — expanded layout. */
export function CreditCatalogDockPanel({
  lang,
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
  onCheckoutAmountField,
  onSaleCustomerId,
  onSaleCustomerName,
  onSaleCustomerPhone,
}: {
  lang: Language;
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
  onCheckoutAmountField: (field: CheckoutAmountField) => void;
  onSaleCustomerId: (id: string) => void;
  onSaleCustomerName: (name: string) => void;
  onSaleCustomerPhone: (phone: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">{t(lang, "paymentCashLabel")}</p>
          <button
            type="button"
            onClick={() => onCheckoutAmountField("cash")}
            className={clsx(
              "mt-1.5 flex min-h-[52px] w-full items-center justify-end rounded-xl border-2 px-3 py-2 text-xl font-black",
              checkoutAmountField === "cash"
                ? "border-waka-500 bg-waka-50 text-slate-900"
                : "border-slate-200 bg-white text-slate-900",
            )}
          >
            UGX {(cashInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
          </button>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{t(lang, "paymentMobileMoneyLabel")}</p>
          <button
            type="button"
            onClick={() => onCheckoutAmountField("mobile")}
            className={clsx(
              "mt-1.5 flex min-h-[52px] w-full items-center justify-end rounded-xl border-2 px-3 py-2 text-xl font-black",
              checkoutAmountField === "mobile"
                ? "border-waka-500 bg-waka-50 text-slate-900"
                : "border-slate-200 bg-white text-slate-900",
            )}
          >
            UGX {(mobileMoneyInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
          </button>
        </div>
      </div>
      <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900">
        {t(lang, "paymentRemainingBalance")}: UGX {computedDebt.toLocaleString()}
      </p>
      {changeDue > 0 ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-900">
          {t(lang, "paymentChangeDueLabel")}: UGX {changeDue.toLocaleString()}
        </p>
      ) : null}
      <div className="rounded-xl border border-slate-200 bg-stone-50 p-4">
        <p className="text-sm font-black text-slate-900">{t(lang, "paymentCreditCustomerDetails")}</p>
        <div className="mt-3 space-y-3">
          <label className="block text-sm font-semibold text-slate-800">
            {t(lang, "paymentDebtNameLabel")}
            <input
              value={saleCustomerName}
              onChange={(e) => onSaleCustomerName(e.target.value)}
              className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-base font-semibold"
              placeholder={t(lang, "paymentDebtNamePlaceholder")}
            />
          </label>
          <label className="block text-sm font-semibold text-slate-800">
            {t(lang, "paymentDebtPhoneLabel")}
            <input
              value={saleCustomerPhone}
              onChange={(e) => onSaleCustomerPhone(e.target.value)}
              className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-base font-semibold"
              placeholder={t(lang, "personPhonePh")}
              inputMode="tel"
            />
          </label>
          {customers.length > 0 ? (
            <label className="block text-sm font-semibold text-slate-800">
              {t(lang, "paymentPickExistingDebt")}
              <select
                ref={customerSelectRef}
                value={saleCustomerId}
                onChange={(e) => onSaleCustomerId(e.target.value)}
                className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-base font-medium"
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
        </div>
      </div>
    </div>
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
  /** Desktop sidebar — focus catalog to add more products. */
  onAddItems?: () => void;
  /** Full desktop — numpad + pay-later render in the catalog column. */
  catalogDock?: boolean;
  catalogNumpadOpen?: boolean;
  onCatalogNumpadOpenChange?: (open: boolean) => void;
};

function CartDockBody({
  lang,
  draftLines,
  draftCartStats,
  draftPayable,
  checkoutTotals,
  productById,
  sidebarCompact = false,
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
  sidebarCompact?: boolean;
  onIncrement: (line: SaleLine) => void;
  onDecrement: (line: SaleLine) => void;
  onQtyTap: (line: SaleLine) => void;
  onLineDiscount: (line: SaleLine) => void;
  onRemoveLine: (productId: string) => void;
  onOpenCartDiscount: () => void;
}): ReactNode {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <DraftCartSummary
            lang={lang}
            stats={draftCartStats}
            payableUgx={draftPayable}
            cartDiscountUgx={checkoutTotals.cartDiscountUgx}
            dock
            sidebarCompact={sidebarCompact}
          />
        </div>
        <button
          type="button"
          onClick={onOpenCartDiscount}
          className={clsx(
            "shrink-0 rounded-lg border border-waka-300 bg-white font-black text-waka-900 active:bg-waka-50",
            sidebarCompact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-xs",
          )}
        >
          {t(lang, "cartDiscountBtn")}
        </button>
      </div>
      <ul className={clsx("rounded-lg border border-waka-200 bg-white shadow-sm", sidebarCompact ? "mt-1 px-1.5 py-0" : "mt-1.5 px-2 py-0.5")}>
        {draftLines.map((line) => (
          <DraftCartLineRow
            key={line.productId}
            lang={lang}
            line={line}
            product={productById.get(line.productId)}
            dock
            sidebarCompact={sidebarCompact}
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
  draftDiscountTotal: _draftDiscountTotal,
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
  onAddItems,
  catalogDock = false,
  catalogNumpadOpen: catalogNumpadOpenProp,
  onCatalogNumpadOpenChange,
}: PosCheckoutPanelProps) {
  const isSidebar = variant === "sidebar";
  const isCompact = !isSidebar;
  const emptyCart = draftLines.length === 0;
  const [sidebarNumpadOpenLocal, setSidebarNumpadOpenLocal] = useState(false);
  const sidebarNumpadOpen = catalogDock ? (catalogNumpadOpenProp ?? false) : sidebarNumpadOpenLocal;
  const setSidebarNumpadOpen = catalogDock && onCatalogNumpadOpenChange ? onCatalogNumpadOpenChange : setSidebarNumpadOpenLocal;
  const needsAmountKeypad = paymentMethod === "cash" || paymentMethod === "credit";

  useEffect(() => {
    if (!needsAmountKeypad) setSidebarNumpadOpen(false);
  }, [needsAmountKeypad]);

  const paymentProps: PaymentBlockProps = {
    lang,
    compact: true,
    dockMode: true,
    hideNumpad: true,
    hideCreditDockPanel: catalogDock && isSidebar,
    sidebarCompact: catalogDock && isSidebar,
    enterprise: false,
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

  return (
    <div
      ref={checkoutPanelRef}
      className={clsx(
        "flex min-h-0 flex-col",
        isSidebar
          ? "h-full max-h-[calc(100dvh-5.25rem)] rounded-xl border border-waka-200 bg-waka-50/90 shadow-waka-sm"
          : "h-full bg-waka-50",
      )}
    >
      <header
        className={clsx(
          "flex shrink-0 items-center gap-1.5 border-b border-waka-200 bg-waka-50",
          isCompact ? "px-3 py-2.5" : catalogDock ? "px-2 py-2" : "px-3 py-3",
          isSidebar && "rounded-t-[1.35rem]",
        )}
      >
        <button
          type="button"
          onClick={onClearDraft}
          disabled={emptyCart}
          className={clsx(
            "shrink-0 rounded-full border border-slate-200 bg-white font-semibold text-slate-600 shadow-sm active:bg-slate-50 disabled:opacity-40",
            catalogDock && isSidebar ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm",
          )}
        >
          {clearSaleLabel}
        </button>
        <h2
          id="pos-checkout-title"
          className={clsx(
            "min-w-0 flex-1 truncate text-center font-black text-waka-950",
            catalogDock && isSidebar ? "text-base" : "text-lg",
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
              isCompact ? "px-3 py-2 text-sm" : "px-3 py-2 text-sm",
            )}
          >
            {t(lang, "posAddMoreItems")}
          </button>
        ) : isSidebar && onAddItems ? (
          <button
            type="button"
            onClick={onAddItems}
            className={clsx(
              "shrink-0 rounded-full border border-waka-300 bg-white font-bold text-waka-900 shadow-sm active:bg-waka-50",
              catalogDock ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-sm",
            )}
          >
            {t(lang, "posAddMoreItems")}
          </button>
        ) : (
          <span className={clsx("shrink-0", catalogDock && isSidebar ? "w-10" : isCompact ? "w-12" : "w-[4.5rem]")} aria-hidden />
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
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={clsx(
              "overflow-y-auto overscroll-y-contain border-b border-waka-200 [-webkit-overflow-scrolling:touch]",
              catalogDock && isSidebar
                ? "min-h-0 flex-1 shrink px-2 py-1.5"
                : clsx(
                    "shrink-0",
                    isSidebar
                      ? sidebarNumpadOpen
                        ? "max-h-[min(28%,10rem)] px-2.5 py-2"
                        : "max-h-[min(42%,15rem)] px-2.5 py-2"
                      : "max-h-[min(36dvh,14rem)] px-3 py-2",
                  ),
            )}
          >
            <CartDockBody
              lang={lang}
              draftLines={draftLines}
              draftCartStats={draftCartStats}
              draftPayable={draftPayable}
              checkoutTotals={checkoutTotals}
              productById={productById}
              sidebarCompact={catalogDock && isSidebar}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
              onQtyTap={onQtyTap}
              onLineDiscount={onLineDiscount}
              onRemoveLine={onRemoveLine}
              onOpenCartDiscount={onOpenCartDiscount}
            />
          </div>
          <div
            className={clsx(
              catalogDock && isSidebar ? "shrink-0 px-2 py-1.5" : "min-h-0 flex-1 overflow-y-auto overscroll-y-contain",
              !catalogDock && isSidebar && "px-2.5 py-2",
              !isSidebar && "px-3 py-2",
            )}
          >
            <PaymentBlock {...paymentProps} />
          </div>
          <div
            className={clsx(
              "shrink-0 border-t border-waka-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)]",
              catalogDock && isSidebar ? "px-2 py-1.5" : isSidebar ? "px-2.5 py-2" : "px-3 py-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]",
            )}
          >
            {canSavePending && paymentMethod !== "credit" ? (
              <button
                type="button"
                onClick={onSavePending}
                className={clsx(
                  "w-full rounded-lg border border-amber-300 bg-amber-50 font-black text-amber-950 active:bg-amber-100",
                  catalogDock && isSidebar ? "mb-1 py-1 text-[10px]" : isSidebar ? "mb-2 py-1.5 text-xs" : "mb-2 py-2 text-sm",
                )}
              >
                {savePendingLabel}
              </button>
            ) : null}
            {isSidebar ? (
              catalogDock ? (
                <div className="flex gap-1.5">
                  {needsAmountKeypad ? (
                    <button
                      type="button"
                      onClick={() => setSidebarNumpadOpen(true)}
                      aria-label={t(lang, "posKeypadShow")}
                      title={t(lang, "posKeypadShow")}
                      className="flex h-10 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-emerald-600 text-[10px] font-black leading-none text-white shadow-sm active:bg-emerald-700"
                    >
                      ABC
                    </button>
                  ) : null}
                  <button
                    ref={saveButtonRef}
                    type="button"
                    onClick={onFinishSale}
                    disabled={emptyCart}
                    className="min-h-[40px] flex-1 rounded-lg bg-emerald-600 py-2 text-sm font-black text-white shadow-md active:bg-emerald-700 disabled:opacity-40"
                  >
                    {saveSaleLabel}
                  </button>
                </div>
              ) : sidebarNumpadOpen && needsAmountKeypad ? (
                <CheckoutNumpadDock
                  sidebar
                  onDigit={onAppendCheckoutDigit}
                  onClear={onClearCheckoutAmount}
                  onSave={onFinishSale}
                  saveLabel={saveSaleLabel}
                  saveDisabled={emptyCart}
                  saveButtonRef={saveButtonRef}
                />
              ) : (
                <div className="flex gap-2">
                  {needsAmountKeypad ? (
                    <button
                      type="button"
                      onClick={() => setSidebarNumpadOpen(true)}
                      aria-label={t(lang, "posKeypadShow")}
                      title={t(lang, "posKeypadShow")}
                      className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-emerald-600 text-xs font-black leading-none text-white shadow-md active:bg-emerald-700"
                    >
                      ABC
                    </button>
                  ) : null}
                  <button
                    ref={saveButtonRef}
                    type="button"
                    onClick={onFinishSale}
                    disabled={emptyCart}
                    className="min-h-[48px] flex-1 rounded-xl bg-emerald-600 py-3 text-base font-black text-white shadow-lg active:bg-emerald-700 disabled:opacity-40"
                  >
                    {saveSaleLabel}
                  </button>
                </div>
              )
            ) : needsAmountKeypad ? (
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
            {isSidebar && sidebarNumpadOpen && needsAmountKeypad && !catalogDock ? (
              <button
                type="button"
                onClick={() => setSidebarNumpadOpen(false)}
                className="mt-2 w-full rounded-lg py-1 text-center text-[11px] font-bold text-stone-500 active:text-stone-800"
              >
                {t(lang, "posKeypadHide")}
              </button>
            ) : null}
          </div>
        </div>
      )}

      <footer className="hidden" aria-hidden />
    </div>
  );
}
