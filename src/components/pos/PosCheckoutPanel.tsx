import { memo, useEffect, useState, type ReactNode, type RefObject } from "react";
import clsx from "clsx";
import { Check, Keyboard } from "lucide-react";
import type { Language, Product, SaleLine } from "../../types";
import { t } from "../../lib/i18n";
import type { DraftCartStats, DraftCheckoutTotals } from "../../lib/draftCart";
import {
  CHECKOUT_ALPHA_ROW_COLS,
  CHECKOUT_ALPHA_ROWS,
  type CheckoutInputField,
  type CheckoutKeypadMode,
} from "../../lib/posCheckoutKeypad";
import { DraftCartLineRow } from "./DraftCartLineRow";
import { DraftCartTotalsStack } from "./DraftCartTotalsStack";
import { MobileSheetCartItems } from "./MobileSheetCartItems";
import { VirtualizedDraftCartList } from "./VirtualizedDraftCartList";
import { POS_CHECKOUT_SCROLL_CLASS } from "../../lib/posTouchInteraction";
import { MOBILE_CHECKOUT_ITEMS_AUTO_SHOW_MAX } from "../../lib/posMobileCheckoutItems";
import {
  mapEventToNumericKeypad,
  setPosCashKeypadHardwareCapture,
  shouldCaptureCashKeypadHardwareKey,
} from "../../lib/desktopPosKeyHandlers";

type PaymentMethod = "cash" | "atm" | "mobile_money" | "mixed" | "credit";

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
    ? "min-h-[36px] rounded-lg bg-muted py-1 text-base font-semibold text-foreground active:bg-muted"
    : compact
      ? "min-h-[44px] rounded-xl bg-muted py-1.5 text-lg font-semibold text-foreground active:bg-muted"
      : "min-h-[56px] rounded-2xl bg-muted py-3 text-2xl font-semibold text-foreground active:bg-muted active:brightness-95 motion-reduce:active:brightness-100";

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
          className="w-full min-h-[32px] rounded-lg bg-warning-muted py-1 text-sm font-bold text-warning-foreground active:bg-warning-muted"
        >
          C
        </button>
      ) : allowDecimal && !compact ? (
        <button
          type="button"
          onClick={onClear}
          className="w-full min-h-[52px] rounded-2xl bg-warning-muted py-3 text-lg font-bold text-warning-foreground active:bg-warning-muted"
        >
          C
        </button>
      ) : null}
    </div>
  );
});

/** Italian-style checkout keypad with clear + confirm on the right — numeric or alpha mode. */
export const CheckoutNumpadDock = memo(function CheckoutNumpadDock({
  lang,
  onDigit,
  onClear,
  onSave,
  saveLabel,
  saveDisabled,
  saveButtonRef,
  sidebar = false,
  /** Fill remaining overlay height so 7–9 / 0 are not clipped on short Windows web viewports. */
  fluid = false,
  keypadMode = "numeric",
  onKeypadModeChange,
  showAlphaToggle = false,
}: {
  lang: Language;
  onDigit: (d: string) => void;
  onClear: () => void;
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  saveButtonRef?: RefObject<HTMLButtonElement | null>;
  sidebar?: boolean;
  fluid?: boolean;
  keypadMode?: CheckoutKeypadMode;
  onKeypadModeChange?: (mode: CheckoutKeypadMode) => void;
  showAlphaToggle?: boolean;
}) {
  const keyClass = fluid
    ? "min-h-0 h-full rounded-lg bg-muted text-lg font-bold text-foreground active:bg-muted sm:text-xl"
    : sidebar
      ? "min-h-[44px] rounded-lg bg-muted py-1 text-xl font-bold text-foreground active:bg-muted"
      : "min-h-[52px] rounded-xl bg-muted py-1.5 text-2xl font-bold text-foreground active:bg-muted";
  const alphaKeyClass = sidebar || fluid
    ? "min-h-[28px] rounded-md bg-muted py-0 text-[10px] font-bold leading-none text-foreground active:bg-muted"
    : "min-h-[32px] rounded-lg bg-muted py-0 text-[11px] font-bold leading-none text-foreground active:bg-muted sm:min-h-[34px] sm:text-xs";
  const modeToggleClass = clsx(
    "rounded-lg font-black active:opacity-90",
    sidebar || fluid ? "min-h-[28px] text-[10px]" : "min-h-[32px] text-[10px] sm:min-h-[34px] sm:text-xs",
    keypadMode === "alpha" ? "bg-waka-600 text-white" : "bg-muted text-foreground",
  );
  const gapClass = sidebar ? "gap-0.5" : fluid ? "gap-1.5" : "gap-1";
  const numericGapClass = sidebar ? "gap-1.5" : fluid ? "gap-1.5" : "gap-2";

  const pressKey = (k: string) => {
    if (k === "⌫") onDigit("back");
    else onDigit(k);
  };

  useEffect(() => {
    setPosCashKeypadHardwareCapture(true);
    const onKeyDown = (e: KeyboardEvent) => {
      if (!shouldCaptureCashKeypadHardwareKey(e)) return;
      if (keypadMode === "alpha") {
        if (e.key === "Enter" || e.code === "NumpadEnter") {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!saveDisabled) onSave();
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          e.stopImmediatePropagation();
          onDigit("back");
          return;
        }
        if (e.key === "Delete") {
          e.preventDefault();
          e.stopImmediatePropagation();
          onClear();
          return;
        }
        if (e.key === " " || e.key === "Spacebar") {
          e.preventDefault();
          e.stopImmediatePropagation();
          onDigit("space");
          return;
        }
        if (/^[a-zA-Z]$/.test(e.key)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          onDigit(e.key);
        }
        return;
      }
      const mapped = mapEventToNumericKeypad(e, false);
      if (!mapped) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (mapped === "enter") {
        if (!saveDisabled) onSave();
        return;
      }
      if (mapped === "C") {
        onClear();
        return;
      }
      onDigit(mapped);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      setPosCashKeypadHardwareCapture(false);
    };
  }, [keypadMode, onClear, onDigit, onSave, saveDisabled]);

  const numericKeys = (
    <>
      <div className={clsx("grid min-h-0 grid-cols-3", numericGapClass, fluid && "h-full grid-rows-3")}>
        {(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => (
          <button key={k} type="button" onClick={() => onDigit(k)} className={keyClass}>
            {k}
          </button>
        ))}
      </div>
      <div className={clsx("grid min-h-0 grid-cols-3", numericGapClass, fluid && "h-full")}>
        {showAlphaToggle ? (
          <button
            type="button"
            onClick={() => onKeypadModeChange?.("alpha")}
            className={clsx(keyClass, "text-sm font-black uppercase tracking-wide")}
            aria-label={t(lang, "posKeypadAlpha")}
          >
            abcd
          </button>
        ) : (
          <button type="button" onClick={() => onDigit("00")} className={keyClass}>
            00
          </button>
        )}
        <button type="button" onClick={() => onDigit("0")} className={keyClass}>
          0
        </button>
        <button type="button" onClick={() => onDigit("back")} className={keyClass}>
          ⌫
        </button>
      </div>
    </>
  );

  return (
    <div
      className={clsx(
        "grid min-h-0",
        fluid ? "h-full grid-cols-[minmax(0,1fr)_4.5rem] gap-1.5" : sidebar ? "grid-cols-[1fr_4.25rem] gap-2" : "grid-cols-[1fr_5rem] gap-2",
      )}
      data-pos-checkout-numpad={fluid ? "fluid" : sidebar ? "sidebar" : "sheet"}
    >
      <div
        className={
          fluid && keypadMode === "numeric"
            ? "grid h-full min-h-0 grid-rows-[3fr_1fr] gap-1.5"
            : clsx("flex min-h-0 flex-col", gapClass)
        }
      >
        {keypadMode === "alpha" ? (
          <>
            {CHECKOUT_ALPHA_ROWS.map((row, rowIdx) => (
              <div
                key={rowIdx}
                className={clsx("grid", sidebar || fluid ? "gap-0.5" : "gap-1")}
                style={{ gridTemplateColumns: `repeat(${CHECKOUT_ALPHA_ROW_COLS[rowIdx]}, minmax(0, 1fr))` }}
              >
                {row.map((k) => (
                  <button key={k} type="button" onClick={() => pressKey(k)} className={alphaKeyClass}>
                    {k}
                  </button>
                ))}
              </div>
            ))}
            <div className={clsx("grid grid-cols-3", sidebar || fluid ? "gap-0.5" : "gap-1")}>
              <button
                type="button"
                onClick={() => onKeypadModeChange?.("numeric")}
                className={modeToggleClass}
                aria-label={t(lang, "posKeypadNumeric")}
              >
                123
              </button>
              <button
                type="button"
                onClick={() => onDigit("space")}
                className={clsx(alphaKeyClass, "col-span-2 text-[10px] font-black uppercase tracking-wide sm:text-xs")}
              >
                {t(lang, "posKeypadSpace")}
              </button>
            </div>
          </>
        ) : (
          numericKeys
        )}
      </div>
      <div className={clsx("flex min-h-0 flex-col gap-1.5", fluid ? "h-full" : "self-start gap-2")}>
        <button
          type="button"
          onClick={onClear}
          className={clsx(
            "rounded-xl bg-danger font-black text-white active:bg-danger",
            fluid ? "min-h-[2.25rem] shrink-0 text-lg" : sidebar ? "min-h-[44px] text-lg" : "min-h-[52px] text-xl",
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
            "flex min-h-0 flex-col items-center justify-center gap-1 rounded-xl bg-success px-1 py-2 font-black leading-tight text-white shadow-md active:bg-success/90 disabled:opacity-40",
            fluid
              ? "flex-1 text-xs"
              : sidebar
                ? "min-h-[7.5rem] text-xs"
                : keypadMode === "alpha"
                  ? "min-h-[8.5rem] text-sm"
                  : "min-h-0 flex-1",
          )}
        >
          <Check className={clsx("stroke-[3]", sidebar || fluid ? "h-6 w-6" : "h-7 w-7")} aria-hidden />
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
  checkoutAmountField: CheckoutInputField;
  changeDue: number;
  computedDebt: number;
  saleCustomerId: string;
  saleCustomerName: string;
  saleCustomerPhone: string;
  customers: { id: string; name: string; debtBalanceUgx: number }[];
  customerSelectRef?: RefObject<HTMLSelectElement | null>;
  onPaymentMethod: (method: PaymentMethod) => void;
  onCheckoutInputField: (field: CheckoutInputField) => void;
  onAppendCheckoutDigit: (d: string) => void;
  onClearCheckoutAmount: () => void;
  onSaleCustomerId: (id: string) => void;
  onSaleCustomerName: (name: string) => void;
  onSaleCustomerPhone: (phone: string) => void;
  hideCreditDockPanel?: boolean;
  /** Desktop sidebar with external catalog dock — tighter payment strip. */
  sidebarCompact?: boolean;
  /** Open the on-screen keypad to type cash received (cash / pay-later). */
  onOpenAmountKeypad?: () => void;
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
  onCheckoutInputField,
  onAppendCheckoutDigit,
  onClearCheckoutAmount,
  onSaleCustomerId,
  onSaleCustomerName,
  onSaleCustomerPhone,
  hideCreditDockPanel = false,
  sidebarCompact = false,
  onOpenAmountKeypad,
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
            "font-black text-foreground",
            enterprise
              ? "flex items-baseline justify-between gap-2 text-base"
              : compact
                ? "flex items-baseline justify-between gap-2 text-lg"
                : "text-3xl",
          )}
        >
          <span className={compact ? "text-sm font-bold text-muted-foreground" : undefined}>
            {checkoutTotals.cartDiscountUgx > 0 ? t(lang, "payableTotalLabel") : t(lang, "totalLabel")}
          </span>
          <span className="text-waka-700">UGX {draftPayable.toLocaleString()}</span>
        </p>
      ) : null}

      <div className={dockMode ? "mt-0" : compact ? "mt-2" : "mt-4"}>
        <p
          className={clsx(
            "font-black uppercase tracking-wide text-muted-foreground",
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
                if (method === "cash" || method === "credit") onCheckoutInputField("cash");
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
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {t(lang, `paymentMethod_${method}`)}
            </button>
          ))}
        </div>
      </div>

      {paymentMethod === "credit" && dockMode && hideCreditDockPanel ? (
        <p className="mt-1.5 rounded-md bg-warning-muted px-2 py-1 text-[10px] font-semibold text-warning-foreground">
          {t(lang, "posDesktopCreditPanelHint")}
        </p>
      ) : null}

      {paymentMethod === "cash" || (paymentMethod === "credit" && !dockMode) ? (
        <div className={sidebarCompact ? "mt-1.5" : dockMode ? "mt-2" : compact ? "mt-2" : "mt-4"}>
          <p
            className={
              sidebarCompact
                ? "text-[10px] font-semibold text-foreground"
                : dockMode
                  ? "text-sm font-semibold text-foreground"
                  : compact
                    ? "text-xs font-semibold text-foreground"
                    : "text-base font-semibold text-foreground"
            }
          >
            {paymentMethod === "cash" ? t(lang, "paymentCashReceivedLabel") : t(lang, "paymentCashLabel")}
          </p>
          <button
            type="button"
            onClick={() => {
              onCheckoutInputField("cash");
              onOpenAmountKeypad?.();
            }}
            className={clsx(
              amountBtnClass,
              sidebarCompact && "mt-1 min-h-[36px] rounded-lg px-2 py-1 text-base",
              dockMode && !sidebarCompact && "mt-1.5 min-h-[48px] rounded-xl px-3 py-2 text-xl",
              checkoutAmountField === "cash"
                ? "border-waka-500 bg-waka-50 text-foreground"
                : "border-border bg-card text-foreground",
            )}
          >
            UGX {(cashInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
          </button>
        </div>
      ) : null}

      {paymentMethod === "credit" && !dockMode ? (
        <div className={compact ? "mt-2" : "mt-4"}>
          <p className={compact ? "text-xs font-semibold text-foreground" : "text-base font-semibold text-foreground"}>
            {t(lang, "paymentMobileMoneyLabel")}
          </p>
          <button
            type="button"
            onClick={() => onCheckoutInputField("mobile")}
            className={clsx(
              amountBtnClass,
              checkoutAmountField === "mobile"
                ? "border-waka-500 bg-waka-50 text-foreground"
                : "border-border bg-card text-foreground",
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
              <p className="text-[11px] font-semibold leading-tight text-foreground">{t(lang, "paymentCashLabel")}</p>
              <button
                type="button"
                onClick={() => onCheckoutInputField("cash")}
                className={clsx(
                  "mt-1 flex min-h-[44px] w-full items-center justify-end rounded-xl border-2 px-2 py-1.5 text-base font-black",
                  checkoutAmountField === "cash"
                    ? "border-waka-500 bg-waka-50 text-foreground"
                    : "border-border bg-card text-foreground",
                )}
              >
                UGX {(cashInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
              </button>
            </div>
            <div>
              <p className="text-[11px] font-semibold leading-tight text-foreground">{t(lang, "paymentMobileMoneyLabel")}</p>
              <button
                type="button"
                onClick={() => onCheckoutInputField("mobile")}
                className={clsx(
                  "mt-1 flex min-h-[44px] w-full items-center justify-end rounded-xl border-2 px-2 py-1.5 text-base font-black",
                  checkoutAmountField === "mobile"
                    ? "border-waka-500 bg-waka-50 text-foreground"
                    : "border-border bg-card text-foreground",
                )}
              >
                UGX {(mobileMoneyInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
              </button>
            </div>
          </div>
          <p className="mt-1.5 rounded-md bg-warning-muted px-2 py-1 text-[10px] font-bold text-warning-foreground">
            {t(lang, "paymentRemainingBalance")}: UGX {computedDebt.toLocaleString()}
          </p>
          <div className="mt-2 space-y-2">
            <div>
              <p className="text-[11px] font-semibold text-foreground">{t(lang, "paymentDebtNameLabel")}</p>
              <button
                type="button"
                onClick={() => onCheckoutInputField("customerName")}
                className={clsx(
                  "mt-1 flex min-h-[44px] w-full items-center rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold",
                  checkoutAmountField === "customerName"
                    ? "border-waka-500 bg-waka-50 text-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {saleCustomerName.trim() || t(lang, "paymentDebtNamePlaceholder")}
              </button>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-foreground">{t(lang, "paymentDebtPhoneLabel")}</p>
              <button
                type="button"
                onClick={() => onCheckoutInputField("customerPhone")}
                className={clsx(
                  "mt-1 flex min-h-[44px] w-full items-center rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold",
                  checkoutAmountField === "customerPhone"
                    ? "border-waka-500 bg-waka-50 text-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {saleCustomerPhone.trim() || t(lang, "personPhonePh")}
              </button>
            </div>
            {customers.length > 0 ? (
              <label className="block text-xs font-semibold text-foreground">
                {t(lang, "paymentPickExistingDebt")}
                <select
                  ref={customerSelectRef}
                  value={saleCustomerId}
                  onChange={(e) => onSaleCustomerId(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-sm font-medium"
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
          {hideNumpad ? (
            <p className="mt-1.5 text-[10px] font-semibold text-muted-foreground">{t(lang, "posKeypadAlphaHint")}</p>
          ) : null}
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
            "font-black text-success",
            sidebarCompact
              ? "mt-1 rounded px-2 py-0.5 text-[10px] font-bold"
              : dockMode
                ? "mt-1.5 rounded-md bg-success-muted px-2.5 py-1.5 text-sm"
                : compact
                  ? "mt-1.5 rounded-lg bg-success-muted px-3 py-1.5 text-sm"
                  : "mt-3 rounded-xl bg-success-muted px-4 py-3 text-base",
            !sidebarCompact && dockMode && "bg-success-muted",
            !sidebarCompact && compact && "bg-success-muted",
            !sidebarCompact && !dockMode && !compact && "bg-success-muted",
          )}
        >
          {t(lang, "paymentChangeDueLabel")}: UGX {changeDue.toLocaleString()}
        </p>
      ) : null}

      {paymentMethod === "credit" && !dockMode ? (
        <>
          <p className={clsx("rounded-xl bg-warning-muted font-bold text-warning-foreground", compact ? "mt-2 px-3 py-1.5 text-xs" : "mt-3 px-4 py-2 text-sm")}>
            {t(lang, "paymentRemainingBalance")}: UGX {computedDebt.toLocaleString()}
          </p>
          <div className={clsx("grid gap-2", compact ? "mt-2" : "mt-4 sm:grid-cols-2 sm:gap-3")}>
            <label className={clsx("block font-semibold text-foreground", compact ? "text-xs" : "text-base")}>
              {t(lang, "paymentDebtNameLabel")}
              <input
                value={saleCustomerName}
                onChange={(e) => onSaleCustomerName(e.target.value)}
                className={clsx(
                  "mt-1 w-full rounded-xl border-2 border-border bg-card font-semibold",
                  compact ? "min-h-[44px] px-3 py-2 text-sm" : "mt-2 min-h-[52px] rounded-2xl px-4 py-3 text-lg",
                )}
                placeholder={t(lang, "paymentDebtNamePlaceholder")}
              />
            </label>
            <label className={clsx("block font-semibold text-foreground", compact ? "text-xs" : "text-base")}>
              {t(lang, "paymentDebtPhoneLabel")}
              <input
                value={saleCustomerPhone}
                onChange={(e) => onSaleCustomerPhone(e.target.value)}
                className={clsx(
                  "mt-1 w-full rounded-xl border-2 border-border bg-card font-semibold",
                  compact ? "min-h-[44px] px-3 py-2 text-sm" : "mt-2 min-h-[52px] rounded-2xl px-4 py-3 text-lg",
                )}
                placeholder={t(lang, "personPhonePh")}
                inputMode="tel"
              />
            </label>
          </div>
          {customers.length > 0 ? (
            <label className={clsx("block font-semibold text-foreground", compact ? "mt-2 text-xs" : "mt-4 text-base")}>
              {t(lang, "paymentPickExistingDebt")}
              <select
                ref={customerSelectRef}
                value={saleCustomerId}
                onChange={(e) => onSaleCustomerId(e.target.value)}
                className={clsx(
                  "mt-1 w-full rounded-xl border-2 border-border bg-card font-medium",
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
  onCheckoutInputField,
  onSaleCustomerId,
  onSaleCustomerName,
  onSaleCustomerPhone,
  useCustomKeypad = false,
}: {
  lang: Language;
  cashInput: string;
  mobileMoneyInput: string;
  checkoutAmountField: CheckoutInputField;
  changeDue: number;
  computedDebt: number;
  saleCustomerId: string;
  saleCustomerName: string;
  saleCustomerPhone: string;
  customers: { id: string; name: string; debtBalanceUgx: number }[];
  customerSelectRef?: RefObject<HTMLSelectElement | null>;
  onCheckoutInputField: (field: CheckoutInputField) => void;
  onSaleCustomerId: (id: string) => void;
  onSaleCustomerName: (name: string) => void;
  onSaleCustomerPhone: (phone: string) => void;
  useCustomKeypad?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{t(lang, "paymentCashLabel")}</p>
          <button
            type="button"
            onClick={() => onCheckoutInputField("cash")}
            className={clsx(
              "mt-1.5 flex min-h-[52px] w-full items-center justify-end rounded-xl border-2 px-3 py-2 text-xl font-black",
              checkoutAmountField === "cash"
                ? "border-waka-500 bg-waka-50 text-foreground"
                : "border-border bg-card text-foreground",
            )}
          >
            UGX {(cashInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
          </button>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{t(lang, "paymentMobileMoneyLabel")}</p>
          <button
            type="button"
            onClick={() => onCheckoutInputField("mobile")}
            className={clsx(
              "mt-1.5 flex min-h-[52px] w-full items-center justify-end rounded-xl border-2 px-3 py-2 text-xl font-black",
              checkoutAmountField === "mobile"
                ? "border-waka-500 bg-waka-50 text-foreground"
                : "border-border bg-card text-foreground",
            )}
          >
            UGX {(mobileMoneyInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
          </button>
        </div>
      </div>
      <p className="rounded-lg bg-warning-muted px-3 py-2 text-sm font-bold text-warning-foreground">
        {t(lang, "paymentRemainingBalance")}: UGX {computedDebt.toLocaleString()}
      </p>
      {changeDue > 0 ? (
        <p className="rounded-lg bg-success-muted px-3 py-2 text-sm font-black text-success">
          {t(lang, "paymentChangeDueLabel")}: UGX {changeDue.toLocaleString()}
        </p>
      ) : null}
      <div className="rounded-xl border border-border bg-muted p-4">
        <p className="text-sm font-black text-foreground">{t(lang, "paymentCreditCustomerDetails")}</p>
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{t(lang, "paymentDebtNameLabel")}</p>
            {useCustomKeypad ? (
              <button
                type="button"
                onClick={() => onCheckoutInputField("customerName")}
                className={clsx(
                  "mt-1.5 flex min-h-[48px] w-full items-center rounded-xl border-2 px-3 py-2 text-left text-base font-semibold",
                  checkoutAmountField === "customerName"
                    ? "border-waka-500 bg-waka-50 text-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {saleCustomerName.trim() || t(lang, "paymentDebtNamePlaceholder")}
              </button>
            ) : (
              <input
                value={saleCustomerName}
                onChange={(e) => onSaleCustomerName(e.target.value)}
                className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                placeholder={t(lang, "paymentDebtNamePlaceholder")}
              />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{t(lang, "paymentDebtPhoneLabel")}</p>
            {useCustomKeypad ? (
              <button
                type="button"
                onClick={() => onCheckoutInputField("customerPhone")}
                className={clsx(
                  "mt-1.5 flex min-h-[48px] w-full items-center rounded-xl border-2 px-3 py-2 text-left text-base font-semibold",
                  checkoutAmountField === "customerPhone"
                    ? "border-waka-500 bg-waka-50 text-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                {saleCustomerPhone.trim() || t(lang, "personPhonePh")}
              </button>
            ) : (
              <input
                value={saleCustomerPhone}
                onChange={(e) => onSaleCustomerPhone(e.target.value)}
                className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                placeholder={t(lang, "personPhonePh")}
                inputMode="tel"
              />
            )}
          </div>
          {customers.length > 0 ? (
            <label className="block text-sm font-semibold text-foreground">
              {t(lang, "paymentPickExistingDebt")}
              <select
                ref={customerSelectRef}
                value={saleCustomerId}
                onChange={(e) => onSaleCustomerId(e.target.value)}
                className="mt-1.5 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-medium"
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

export type { CheckoutInputField, CheckoutKeypadMode } from "../../lib/posCheckoutKeypad";

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
  checkoutAmountField: CheckoutInputField;
  checkoutKeypadMode?: CheckoutKeypadMode;
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
  pharmacyMode?: boolean;
  onBatchTap?: (line: SaleLine) => void;
  onPaymentMethod: (method: PaymentMethod) => void;
  onCheckoutInputField: (field: CheckoutInputField) => void;
  onCheckoutKeypadModeChange?: (mode: CheckoutKeypadMode) => void;
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
  /**
   * M1.1-R2 — parent bottom sheet already owns safe-area / keyboard inset.
   * When true, overlay footer must not apply env(safe-area-inset-bottom) again.
   */
  sheetInsetOwned?: boolean;
};

function CartDockBody({
  lang,
  draftLines,
  draftCartStats,
  productById,
  sidebarCompact = false,
  onIncrement,
  onDecrement,
  onQtyTap,
  onLineDiscount,
  onRemoveLine,
  onOpenCartDiscount,
  pharmacyMode = false,
  onBatchTap,
}: {
  lang: Language;
  draftLines: SaleLine[];
  draftCartStats: DraftCartStats;
  productById: Map<string, Product>;
  sidebarCompact?: boolean;
  onIncrement: (line: SaleLine) => void;
  onDecrement: (line: SaleLine) => void;
  onQtyTap: (line: SaleLine) => void;
  onLineDiscount: (line: SaleLine) => void;
  onRemoveLine: (productId: string) => void;
  onOpenCartDiscount: () => void;
  pharmacyMode?: boolean;
  onBatchTap?: (line: SaleLine) => void;
}): ReactNode {
  const unitShown = Number.isInteger(draftCartStats.unitCount)
    ? String(draftCartStats.unitCount)
    : draftCartStats.unitCount.toFixed(2).replace(/\.?0+$/, "");
  const estimateRowPx = pharmacyMode ? (sidebarCompact ? 108 : 120) : sidebarCompact ? 92 : 104;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5">
        <div
          className={clsx(
            "min-w-0 flex-1 rounded-lg border border-waka-200 bg-waka-50/90 font-bold text-muted-foreground",
            sidebarCompact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
          )}
        >
          {draftCartStats.productCount} {t(lang, "posCartProductsShort").toLowerCase()} · {unitShown}{" "}
          {t(lang, "posCartUnitsShort").toLowerCase()}
        </div>
        <button
          type="button"
          onClick={onOpenCartDiscount}
          className={clsx(
            "shrink-0 rounded-lg border border-waka-300 bg-card font-black text-waka-900 active:bg-waka-50",
            sidebarCompact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-xs",
          )}
        >
          {t(lang, "cartDiscountBtn")}
        </button>
      </div>
      <div
        className={clsx(
          "mt-1.5 min-h-0 flex-1 overflow-hidden rounded-lg border border-waka-200 bg-card shadow-sm",
          sidebarCompact ? "px-1.5" : "px-2",
        )}
      >
        <VirtualizedDraftCartList
          lines={draftLines}
          estimateRowPx={estimateRowPx}
          listAriaLabel={t(lang, "posCartProductsShort")}
          className={clsx("h-full min-h-0", POS_CHECKOUT_SCROLL_CLASS)}
          renderRow={(line) => (
            <DraftCartLineRow
              lang={lang}
              line={line}
              product={productById.get(line.productId)}
              dock
              sidebarCompact={sidebarCompact}
              pharmacyMode={pharmacyMode}
              onBatchTap={onBatchTap ? () => onBatchTap(line) : undefined}
              onIncrement={() => onIncrement(line)}
              onDecrement={() => onDecrement(line)}
              onQtyTap={() => onQtyTap(line)}
              onDiscount={() => onLineDiscount(line)}
              onRemove={() => onRemoveLine(line.productId)}
            />
          )}
        />
      </div>
    </div>
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
  checkoutKeypadMode = "numeric",
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
  pharmacyMode = false,
  onBatchTap,
  onPaymentMethod,
  onCheckoutInputField,
  onCheckoutKeypadModeChange,
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
  sheetInsetOwned = false,
}: PosCheckoutPanelProps) {
  const isSidebar = variant === "sidebar";
  const isCompact = !isSidebar;
  /**
   * M1.1-R3 — mobile bottom-sheet composition zones.
   * Only cart lines scroll. Totals, payment state, keypad, Complete Sale stay pinned.
   */
  const mobileSheetBudget = !isSidebar;
  const emptyCart = draftLines.length === 0;
  const [sheetCartExpanded, setSheetCartExpanded] = useState(false);
  const [sidebarNumpadOpenLocal, setSidebarNumpadOpenLocal] = useState(false);
  const sidebarNumpadOpen = catalogDock ? (catalogNumpadOpenProp ?? false) : sidebarNumpadOpenLocal;
  const setSidebarNumpadOpen = catalogDock && onCatalogNumpadOpenChange ? onCatalogNumpadOpenChange : setSidebarNumpadOpenLocal;
  const needsAmountKeypad = paymentMethod === "cash" || paymentMethod === "credit";

  useEffect(() => {
    if (!needsAmountKeypad) setSidebarNumpadOpen(false);
  }, [needsAmountKeypad]);

  useEffect(() => {
    if (draftLines.length <= MOBILE_CHECKOUT_ITEMS_AUTO_SHOW_MAX) {
      setSheetCartExpanded(false);
    }
  }, [draftLines.length]);

  const showAlphaToggle = paymentMethod === "credit";
  const numpadDockProps = {
    lang,
    onDigit: onAppendCheckoutDigit,
    onClear: onClearCheckoutAmount,
    onSave: onFinishSale,
    saveLabel: saveSaleLabel,
    saveDisabled: emptyCart,
    saveButtonRef,
    keypadMode: checkoutKeypadMode,
    onKeypadModeChange: (mode: CheckoutKeypadMode) => {
      onCheckoutKeypadModeChange?.(mode);
      if (mode === "alpha") onCheckoutInputField("customerName");
    },
    showAlphaToggle,
  };

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
    onCheckoutInputField,
    onAppendCheckoutDigit,
    onClearCheckoutAmount,
    onSaleCustomerId,
    onSaleCustomerName,
    onSaleCustomerPhone,
    onOpenAmountKeypad: () => {
      if (needsAmountKeypad) setSidebarNumpadOpen(true);
    },
  };

  return (
    <div
      ref={checkoutPanelRef}
      className={clsx(
        "pos-ds-checkout flex min-h-0 flex-col",
        isSidebar
          ? "h-full max-h-[calc(100dvh-5.25rem)] rounded-xl border border-waka-200 bg-waka-50/90 shadow-waka-sm"
          : "min-h-0 flex-1 bg-waka-50",
      )}
    >
      <header
        className={clsx(
          "flex shrink-0 items-center gap-1.5 border-b border-waka-200 bg-waka-50",
          mobileSheetBudget ? "px-3 py-2" : isCompact ? "px-3 py-2.5" : catalogDock ? "px-2 py-2" : "px-3 py-3",
          isSidebar && "rounded-t-[1.35rem]",
        )}
      >
        <button
          type="button"
          onClick={onClearDraft}
          disabled={emptyCart}
          className={clsx(
            "shrink-0 rounded-full border border-border bg-card font-semibold text-muted-foreground shadow-sm active:bg-muted disabled:opacity-40",
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
              "pos-ds-dialog-btn shrink-0 rounded-full border border-waka-300 bg-card font-bold text-waka-900 shadow-sm active:bg-waka-50",
              "min-h-[44px] px-3 py-2 text-sm",
            )}
          >
            {t(lang, "posCheckoutSheetAddItems")}
          </button>
        ) : isSidebar && onAddItems ? (
          <button
            type="button"
            onClick={onAddItems}
            className={clsx(
              "shrink-0 rounded-full border border-waka-300 bg-card font-bold text-waka-900 shadow-sm active:bg-waka-50",
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
        <div className={clsx("min-h-0 flex-1 p-4", POS_CHECKOUT_SCROLL_CLASS)}>
          <p className="py-8 text-center text-sm font-semibold text-muted-foreground">{t(lang, "posCartEmptyHint")}</p>
        </div>
      ) : mobileSheetBudget ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/*
            M1.1-R5 — remaining viewport → cart; pinned zones take intrinsic height first.
            Only cart scrolls. Totals / payment / keypad / Complete Sale never leave the viewport.
          */}
          <div
            className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden border-b border-waka-200 px-3 py-1.5"
            data-pos-checkout-zone="cart"
          >
            <MobileSheetCartItems
              lang={lang}
              draftLines={draftLines}
              draftCartStats={draftCartStats}
              productById={productById}
              expanded={sheetCartExpanded}
              onExpandedChange={setSheetCartExpanded}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
              onQtyTap={onQtyTap}
              onLineDiscount={onLineDiscount}
              onRemoveLine={onRemoveLine}
              onOpenCartDiscount={onOpenCartDiscount}
              pharmacyMode={pharmacyMode}
              onBatchTap={onBatchTap}
            />
          </div>
          <div className="shrink-0 border-b border-waka-200 px-3 py-1.5" data-pos-checkout-zone="totals">
            <DraftCartTotalsStack
              lang={lang}
              checkoutTotals={checkoutTotals}
              changeDue={changeDue}
              sidebarCompact
            />
          </div>
          <div
            className="max-h-[min(28dvh,12rem)] shrink-0 overflow-y-auto border-b border-waka-200 px-3 py-1.5"
            data-pos-checkout-zone="payment"
          >
            <PaymentBlock {...paymentProps} sidebarCompact />
          </div>
          <div
            className={clsx(
              "shrink-0 border-t border-waka-200 bg-card shadow-[0_-4px_12px_rgba(0,0,0,0.06)]",
              sheetInsetOwned ? "px-3 py-2" : "px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]",
            )}
            data-pos-checkout-zone="action"
          >
            {canSavePending && paymentMethod !== "credit" ? (
              <button
                type="button"
                onClick={onSavePending}
                className="mb-1.5 w-full rounded-lg border border-amber-300 bg-warning-muted py-1.5 text-xs font-black text-warning-foreground active:bg-warning-muted"
              >
                {savePendingLabel}
              </button>
            ) : null}
            {paymentMethod === "credit" || (paymentMethod === "cash" && sidebarNumpadOpen) ? (
              <>
                <CheckoutNumpadDock {...numpadDockProps} />
                {paymentMethod === "cash" ? (
                  <button
                    type="button"
                    onClick={() => setSidebarNumpadOpen(false)}
                    className="mt-1.5 w-full rounded-lg py-1 text-center text-[11px] font-bold text-muted-foreground active:text-foreground"
                  >
                    {t(lang, "posKeypadHide")}
                  </button>
                ) : null}
              </>
            ) : (
              <div className="flex gap-2">
                {paymentMethod === "cash" ? (
                  <button
                    type="button"
                    onClick={() => {
                      onCheckoutInputField("cash");
                      setSidebarNumpadOpen(true);
                    }}
                    aria-label={t(lang, "posKeypadShow")}
                    title={t(lang, "posKeypadShow")}
                    className="flex h-[52px] w-14 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground shadow-sm active:bg-muted/80"
                  >
                    <Keyboard className="h-6 w-6" aria-hidden />
                  </button>
                ) : null}
                <button
                  ref={saveButtonRef}
                  type="button"
                  onClick={onFinishSale}
                  disabled={emptyCart}
                  className="pos-ds-checkout-btn min-h-[52px] flex-1 rounded-xl bg-success py-3.5 text-lg font-black text-white shadow-lg active:bg-success/90 disabled:opacity-40"
                >
                  {saveSaleLabel}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className={clsx(
              "flex min-h-0 flex-col border-b border-waka-200",
              catalogDock && isSidebar
                ? "min-h-0 flex-1 px-2 py-1.5"
                : clsx(
                    "min-h-[8rem] flex-1",
                    isSidebar
                      ? sidebarNumpadOpen
                        ? "max-h-[min(40%,16rem)] px-2.5 py-2"
                        : "px-2.5 py-2"
                      : "px-3 py-2",
                  ),
            )}
          >
            <CartDockBody
              lang={lang}
              draftLines={draftLines}
              draftCartStats={draftCartStats}
              productById={productById}
              sidebarCompact={catalogDock && isSidebar}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
              onQtyTap={onQtyTap}
              onLineDiscount={onLineDiscount}
              onRemoveLine={onRemoveLine}
              onOpenCartDiscount={onOpenCartDiscount}
              pharmacyMode={pharmacyMode}
              onBatchTap={onBatchTap}
            />
          </div>
          <div
            className={clsx(
              "shrink-0 border-b border-waka-200",
              catalogDock && isSidebar ? "px-2 py-1.5" : isSidebar ? "px-2.5 py-2" : "px-3 py-2",
            )}
          >
            <DraftCartTotalsStack
              lang={lang}
              checkoutTotals={checkoutTotals}
              changeDue={changeDue}
              sidebarCompact={catalogDock && isSidebar}
            />
          </div>
          <div
            className={clsx(
              catalogDock && isSidebar ? "shrink-0 px-2 py-1.5" : clsx(POS_CHECKOUT_SCROLL_CLASS, "min-h-0 shrink-0"),
              !catalogDock && isSidebar && "max-h-[min(42%,18rem)] px-2.5 py-2",
              !isSidebar && "max-h-[min(38dvh,16rem)] px-3 py-2",
            )}
          >
            <PaymentBlock {...paymentProps} />
          </div>
          <div
            className={clsx(
              "shrink-0 border-t border-waka-200 bg-card shadow-[0_-4px_12px_rgba(0,0,0,0.06)]",
              catalogDock && isSidebar ? "px-2 py-1.5" : isSidebar ? "px-2.5 py-2" : "px-3 py-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]",
            )}
          >
            {canSavePending && paymentMethod !== "credit" ? (
              <button
                type="button"
                onClick={onSavePending}
                className={clsx(
                  "w-full rounded-lg border border-amber-300 bg-warning-muted font-black text-warning-foreground active:bg-warning-muted",
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
                      className="flex h-10 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-success text-[10px] font-black leading-none text-white shadow-sm active:bg-success/90"
                    >
                      ABC
                    </button>
                  ) : null}
                  <button
                    ref={saveButtonRef}
                    type="button"
                    onClick={onFinishSale}
                    disabled={emptyCart}
                    className="pos-ds-checkout-btn min-h-[40px] flex-1 rounded-lg bg-success py-2 text-sm font-black text-white shadow-md active:bg-success/90 disabled:opacity-40"
                  >
                    {saveSaleLabel}
                  </button>
                </div>
              ) : sidebarNumpadOpen && needsAmountKeypad ? (
                <CheckoutNumpadDock sidebar {...numpadDockProps} />
              ) : (
                <div className="flex gap-2">
                  {needsAmountKeypad ? (
                    <button
                      type="button"
                      onClick={() => setSidebarNumpadOpen(true)}
                      aria-label={t(lang, "posKeypadShow")}
                      title={t(lang, "posKeypadShow")}
                      className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-success text-xs font-black leading-none text-white shadow-md active:bg-success/90"
                    >
                      ABC
                    </button>
                  ) : null}
                  <button
                    ref={saveButtonRef}
                    type="button"
                    onClick={onFinishSale}
                    disabled={emptyCart}
                    className="pos-ds-checkout-btn min-h-[48px] flex-1 rounded-xl bg-success py-3 text-base font-black text-white shadow-lg active:bg-success/90 disabled:opacity-40"
                  >
                    {saveSaleLabel}
                  </button>
                </div>
              )
            ) : needsAmountKeypad ? (
              <CheckoutNumpadDock {...numpadDockProps} />
            ) : (
              <button
                ref={saveButtonRef}
                type="button"
                onClick={onFinishSale}
                disabled={emptyCart}
                className="pos-ds-checkout-btn w-full rounded-xl bg-success py-3.5 text-lg font-black text-white shadow-lg active:bg-success/90 disabled:opacity-40"
              >
                {saveSaleLabel}
              </button>
            )}
            {isSidebar && sidebarNumpadOpen && needsAmountKeypad && !catalogDock ? (
              <button
                type="button"
                onClick={() => setSidebarNumpadOpen(false)}
                className="mt-2 w-full rounded-lg py-1 text-center text-[11px] font-bold text-muted-foreground active:text-foreground"
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
