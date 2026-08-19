import clsx from "clsx";
import { Banknote, CreditCard, Smartphone, Wallet } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { DesktopPosButton } from "./DesktopPosButton";

type PaymentMethod = "cash" | "atm" | "mobile_money" | "mixed" | "credit";

type Props = {
  lang: Language;
  payableUgx: number;
  paymentMethod: PaymentMethod;
  checkoutMethods: PaymentMethod[];
  onPaymentMethod: (method: PaymentMethod) => void;
  onCompleteSale?: () => void;
  completeDisabled?: boolean;
  completeLabel: string;
  className?: string;
};

const METHOD_META: Record<PaymentMethod, { icon: typeof Banknote; labelKey: Parameters<typeof t>[1] }> = {
  cash: { icon: Banknote, labelKey: "paymentMethod_cash" },
  atm: { icon: Wallet, labelKey: "paymentMethod_atm" },
  mobile_money: { icon: Smartphone, labelKey: "paymentMethod_mobile_money" },
  mixed: { icon: Wallet, labelKey: "paymentMethod_mixed" },
  credit: { icon: CreditCard, labelKey: "paymentMethod_credit" },
};

/** Bottom payment bar — large method buttons and order total. */
export function DesktopPaymentPanel({
  lang,
  payableUgx,
  paymentMethod,
  checkoutMethods,
  onPaymentMethod,
  onCompleteSale,
  completeDisabled,
  completeLabel,
  className,
}: Props) {
  return (
    <footer
      className={clsx(
        "desktop-pos-payment-bar flex shrink-0 items-stretch gap-2 border-t border-border bg-card px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        className,
      )}
    >
      <div className="flex min-w-[8rem] shrink-0 flex-col justify-center rounded-lg border border-border bg-muted/60 px-3 py-1.5">
        <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">{t(lang, "payableTotalLabel")}</p>
        <p className="text-xl font-black tabular-nums text-waka-900">UGX {payableUgx.toLocaleString()}</p>
      </div>

      <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5 sm:grid-cols-4">
        {checkoutMethods.map((method) => {
          const meta = METHOD_META[method];
          const Icon = meta.icon;
          return (
            <DesktopPosButton
              key={method}
              size="touch"
              variant="payment"
              selected={paymentMethod === method}
              className="flex-col gap-1 py-2"
              onClick={() => onPaymentMethod(method)}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="text-[11px] leading-tight">{t(lang, meta.labelKey)}</span>
            </DesktopPosButton>
          );
        })}
      </div>

      {onCompleteSale ? (
        <DesktopPosButton
          size="touch"
          variant="success"
          className="min-w-[8.5rem] shrink-0 px-4 text-sm font-black uppercase"
          disabled={completeDisabled}
          onClick={onCompleteSale}
        >
          {completeLabel}
        </DesktopPosButton>
      ) : null}
    </footer>
  );
}
