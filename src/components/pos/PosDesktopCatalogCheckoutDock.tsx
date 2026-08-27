import clsx from "clsx";
import type { RefObject } from "react";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { CheckoutInputField, CheckoutKeypadMode } from "../../lib/posCheckoutKeypad";
import { CheckoutNumpadDock, CreditCatalogDockPanel } from "./PosCheckoutPanel";
import { CheckoutNotePicker } from "./CheckoutNotePicker";

type Props = {
  lang: Language;
  paymentMethod: "cash" | "atm" | "mobile_money" | "mixed" | "credit";
  catalogNumpadOpen: boolean;
  onCatalogNumpadOpenChange: (open: boolean) => void;
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
  customerSelectRef?: RefObject<HTMLSelectElement | null>;
  saveButtonRef?: RefObject<HTMLButtonElement | null>;
  saveSaleLabel: string;
  saveDisabled: boolean;
  onCheckoutInputField: (field: CheckoutInputField) => void;
  onCheckoutKeypadModeChange?: (mode: CheckoutKeypadMode) => void;
  onAppendCheckoutDigit: (d: string) => void;
  /** Add one banknote or coin to the existing cashInput total (desktop cash keypad only). */
  onAddCashNote?: (ugx: number) => void;
  onClearCheckoutAmount: () => void;
  onSaleCustomerId: (id: string) => void;
  onSaleCustomerName: (name: string) => void;
  onSaleCustomerPhone: (phone: string) => void;
  onFinishSale: () => void;
};

/** Full desktop — numpad and pay-later panel in the catalog (shelf) column. */
export function PosDesktopCatalogCheckoutDock({
  lang,
  paymentMethod,
  catalogNumpadOpen,
  onCatalogNumpadOpenChange,
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
  customerSelectRef,
  saveButtonRef,
  saveSaleLabel,
  saveDisabled,
  onCheckoutInputField,
  onCheckoutKeypadModeChange,
  onAppendCheckoutDigit,
  onAddCashNote,
  onClearCheckoutAmount,
  onSaleCustomerId,
  onSaleCustomerName,
  onSaleCustomerPhone,
  onFinishSale,
}: Props) {
  const isCredit = paymentMethod === "credit";
  const needsAmountKeypad = paymentMethod === "cash" || paymentMethod === "credit";
  const showNumpad = catalogNumpadOpen && needsAmountKeypad;
  const showCashWorkspace = paymentMethod === "cash" && Boolean(onAddCashNote);
  const numpad = (
    <CheckoutNumpadDock
      lang={lang}
      fluid
      onDigit={onAppendCheckoutDigit}
      onClear={onClearCheckoutAmount}
      onSave={onFinishSale}
      saveLabel={saveSaleLabel}
      saveDisabled={saveDisabled}
      saveButtonRef={saveButtonRef}
      keypadMode={checkoutKeypadMode}
      onKeypadModeChange={(mode) => {
        onCheckoutKeypadModeChange?.(mode);
        if (mode === "alpha") onCheckoutInputField("customerName");
      }}
      showAlphaToggle={isCredit}
    />
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-waka-200/80 bg-card/80 shadow-none backdrop-blur-md supports-[backdrop-filter]:bg-card/70"
      data-pos-catalog-checkout-dock
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-waka-100 px-3 py-2">
        {showNumpad ? (
          <button
            type="button"
            onClick={() => onCatalogNumpadOpenChange(false)}
            className="inline-flex min-h-[36px] items-center gap-2 rounded-xl bg-waka-600 px-3 py-1.5 text-sm font-black text-white shadow-sm active:bg-waka-700"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t(lang, "posKeypadHide")}
          </button>
        ) : (
          <p className="text-sm font-black text-waka-950">
            {isCredit ? t(lang, "paymentMethod_credit") : t(lang, "posKeypadShow")}
          </p>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2.5">
        {isCredit ? (
          <div className="min-h-0 shrink-0 overflow-y-auto overscroll-y-contain">
            <CreditCatalogDockPanel
              lang={lang}
              cashInput={cashInput}
              mobileMoneyInput={mobileMoneyInput}
              checkoutAmountField={checkoutAmountField}
              changeDue={changeDue}
              computedDebt={computedDebt}
              saleCustomerId={saleCustomerId}
              saleCustomerName={saleCustomerName}
              saleCustomerPhone={saleCustomerPhone}
              customers={customers}
              customerSelectRef={customerSelectRef}
              onCheckoutInputField={onCheckoutInputField}
              onSaleCustomerId={onSaleCustomerId}
              onSaleCustomerName={onSaleCustomerName}
              onSaleCustomerPhone={onSaleCustomerPhone}
              useCustomKeypad
            />
          </div>
        ) : null}

        {showNumpad ? (
          <div className={clsx("flex min-h-0 flex-1 flex-col", isCredit && "mt-3 border-t border-border pt-3")}>
            {!isCredit ? (
              <div className="mb-1.5 shrink-0 rounded-xl border border-border/80 bg-muted/95 px-3 py-1.5">
                <p className="text-xs font-semibold text-muted-foreground">
                  {paymentMethod === "cash" ? t(lang, "paymentCashReceivedLabel") : t(lang, "paymentCashLabel")}
                </p>
                <p className="mt-0.5 text-xl font-black text-waka-700">
                  UGX {(cashInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                </p>
                {changeDue > 0 ? (
                  <p className="mt-0.5 text-sm font-bold text-success">
                    {t(lang, "paymentChangeDueLabel")}: UGX {changeDue.toLocaleString()}
                  </p>
                ) : null}
              </div>
            ) : null}
            {showCashWorkspace && onAddCashNote ? (
              <div className="flex min-h-0 flex-1 gap-2" data-checkout-cash-workspace>
                <CheckoutNotePicker onAddNote={onAddCashNote} />
                <div className="flex w-[13.5rem] shrink-0 flex-col">{numpad}</div>
              </div>
            ) : (
              <div className="min-h-0 flex-1">{numpad}</div>
            )}
          </div>
        ) : isCredit ? (
          <p className="mt-4 rounded-xl border border-dashed border-border bg-muted px-3 py-3 text-center text-sm font-semibold text-muted-foreground">
            {t(lang, "posDesktopCatalogKeypadHint")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
