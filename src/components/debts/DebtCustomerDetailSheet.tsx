import clsx from "clsx";
import type { Customer, Language } from "../../types";
import type { CreditActivityEntry } from "../../lib/customerDebtActivity";
import { t } from "../../lib/i18n";
import { customerInitials, formatActivityWhen } from "../../lib/debtsPageView";
import { ModalSheet } from "../layout/ModalSheet";
import { EnterpriseEmptyState } from "../enterprise/EnterpriseEmptyState";
import { Caption, MonoNumber, SectionTitle } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";
import { Wallet } from "lucide-react";
import { EnterpriseKpiCard } from "../enterprise/EnterpriseKpiCard";

type Props = {
  lang: Language;
  open: boolean;
  customer: Customer | null;
  timeline: CreditActivityEntry[];
  onClose: () => void;
  onReceive: () => void;
  canDebt: boolean;
};

export function DebtCustomerDetailSheet({
  lang,
  open,
  customer,
  timeline,
  onClose,
  onReceive,
  canDebt,
}: Props) {
  if (!customer) return null;

  const localeLang = lang === "sw" ? "sw" : "en";

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      clearNav={false}
      zIndexClass="z-[54]"
      maxHeightClass="max-h-[min(85dvh,40rem)]"
      title={
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-waka-100 text-sm font-black text-waka-800">
            {customerInitials(customer.name)}
          </span>
          <div className="min-w-0">
            <SectionTitle as="h2" className="truncate !text-base">{customer.name}</SectionTitle>
            <Caption className="normal-case">{customer.phone || t(lang, "debtNoPhone")}</Caption>
          </div>
        </div>
      }
      footer={
        <div className="space-y-2">
          {canDebt && customer.debtBalanceUgx > 0 ? (
            <WakaButton
              type="button"
              className="w-full"
              onClick={() => {
                onClose();
                onReceive();
              }}
            >
              {t(lang, "repayDebt")}
            </WakaButton>
          ) : null}
          <WakaButton type="button" variant="secondary" className="w-full" onClick={onClose}>
            {t(lang, "cancel")}
          </WakaButton>
        </div>
      }
    >
      <EnterpriseKpiCard
        icon={Wallet}
        label={t(lang, "debtBalanceLabel")}
        value={`UGX ${customer.debtBalanceUgx.toLocaleString()}`}
        tone={customer.debtBalanceUgx > 0 ? "warning" : "default"}
        className="mb-3"
      />

      <SectionTitle as="h3" className="!text-sm">{t(lang, "creditActivityTitle")}</SectionTitle>
      {timeline.length === 0 ? (
        <EnterpriseEmptyState
          icon={Wallet}
          title={t(lang, "creditActivityEmpty")}
          className="mt-2 !border-0 !bg-transparent !p-4 !shadow-none"
        />
      ) : (
        <ul className="mt-2 space-y-2">
          {timeline.slice(0, 12).map((entry) => (
            <li key={`${entry.kind}-${entry.id}`} className="flex items-start justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
              <div className="min-w-0">
                <Caption className="font-bold normal-case text-foreground">
                  {entry.kind === "credit_sale" ? t(lang, "creditSaleActivity") : t(lang, "debtPaymentActivity")}
                  {entry.receiptSeq != null ? ` #${String(entry.receiptSeq).padStart(3, "0")}` : ""}
                </Caption>
                <Caption>{formatActivityWhen(entry.at, localeLang)}</Caption>
              </div>
              <MonoNumber
                className={clsx(
                  "text-xs",
                  entry.kind === "debt_payment" ? "text-success-foreground" : "text-waka-700",
                )}
              >
                {entry.kind === "debt_payment" ? "−" : "+"}UGX {entry.amountUgx.toLocaleString()}
              </MonoNumber>
            </li>
          ))}
        </ul>
      )}
    </ModalSheet>
  );
}
