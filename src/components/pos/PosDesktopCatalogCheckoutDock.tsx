import clsx from "clsx";
import type { RefObject } from "react";
import { ArrowLeft } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { CheckoutNumpadDock, CreditCatalogDockPanel } from "./PosCheckoutPanel";

type CheckoutAmountField = "cash" | "mobile";

type Props = {
  lang: Language;
  paymentMethod: "cash" | "atm" | "mobile_money" | "mixed" | "credit";
  catalogNumpadOpen: boolean;
  onCatalogNumpadOpenChange: (open: boolean) => void;
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
  saveButtonRef?: RefObject<HTMLButtonElement | null>;
  saveSaleLabel: string;
  saveDisabled: boolean;
  onCheckoutAmountField: (field: CheckoutAmountField) => void;
  onAppendCheckoutDigit: (d: string) => void;
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
  onCheckoutAmountField,
  onAppendCheckoutDigit,
  onClearCheckoutAmount,
  onSaleCustomerId,
  onSaleCustomerName,
  onSaleCustomerPhone,
  onFinishSale,
}: Props) {
  const isCredit = paymentMethod === "credit";
  const needsAmountKeypad = paymentMethod === "cash" || paymentMethod === "credit";
  const showNumpad = catalogNumpadOpen && needsAmountKeypad;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-waka-200 bg-white shadow-waka-sm">
      <header className="flex shrink-0 items-center gap-2 border-b border-waka-100 px-3 py-2.5">
        {showNumpad ? (
          <button
            type="button"
            onClick={() => onCatalogNumpadOpenChange(false)}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-waka-600 px-3 py-2 text-sm font-black text-white shadow-sm active:bg-waka-700"
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4">
        {isCredit ? (
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
            onCheckoutAmountField={onCheckoutAmountField}
            onSaleCustomerId={onSaleCustomerId}
            onSaleCustomerName={onSaleCustomerName}
            onSaleCustomerPhone={onSaleCustomerPhone}
          />
        ) : null}

        {showNumpad ? (
          <div className={clsx(isCredit && "mt-4 border-t border-stone-100 pt-4")}>
            {!isCredit ? (
              <div className="mb-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
                <p className="text-xs font-semibold text-stone-600">
                  {paymentMethod === "cash" ? t(lang, "paymentCashReceivedLabel") : t(lang, "paymentCashLabel")}
                </p>
                <p className="mt-0.5 text-2xl font-black text-waka-700">
                  UGX {(cashInput || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                </p>
                {changeDue > 0 ? (
                  <p className="mt-1 text-sm font-bold text-emerald-800">
                    {t(lang, "paymentChangeDueLabel")}: UGX {changeDue.toLocaleString()}
                  </p>
                ) : null}
              </div>
            ) : null}
            <CheckoutNumpadDock
              onDigit={onAppendCheckoutDigit}
              onClear={onClearCheckoutAmount}
              onSave={onFinishSale}
              saveLabel={saveSaleLabel}
              saveDisabled={saveDisabled}
              saveButtonRef={saveButtonRef}
            />
          </div>
        ) : isCredit ? (
          <p className="mt-4 rounded-xl border border-dashed border-stone-200 bg-stone-50 px-3 py-3 text-center text-sm font-semibold text-stone-600">
            {t(lang, "posDesktopCatalogKeypadHint")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
