import { useEffect, useMemo, useRef, useState } from "react";
import type { Customer, Language } from "../../types";
import { t } from "../../lib/i18n";
import { releaseDebtPaymentSubmitsForAccount } from "../../lib/debtPaymentSubmitGuard";
import { inventoryMovementNamespace } from "../../lib/shopSyncContext";
import { ModalSheet } from "../layout/ModalSheet";
import { EnterpriseTextField } from "../enterprise/EnterpriseTextField";
import { Caption, SectionTitle } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";

type Props = {
  lang: Language;
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onSubmit: (amountUgx: number) => boolean | Promise<boolean>;
};

const QUICK_PCTS = [25, 50, 75] as const;

export function DebtReceivePaymentSheet({ lang, open, customer, onClose, onSubmit }: Props) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    submitInFlightRef.current = false;
    setSubmitting(false);
    setAmount("");
    releaseDebtPaymentSubmitsForAccount(inventoryMovementNamespace());
  }, [open, customer?.id]);

  const balance = customer?.debtBalanceUgx ?? 0;

  const quickAmounts = useMemo(() => {
    if (balance <= 0) return [];
    return [
      ...QUICK_PCTS.map((pct) => ({ label: `${pct}%`, value: Math.max(1, Math.round((balance * pct) / 100)) })),
      { label: t(lang, "debtsPayFull"), value: balance },
    ];
  }, [balance, lang]);

  if (!customer) return null;

  const submit = async () => {
    if (submitInFlightRef.current) return;
    const n = Math.floor(Number(amount.replace(/\D/g, "")) || 0);
    if (n <= 0) return;
    submitInFlightRef.current = true;
    setSubmitting(true);
    let succeeded = false;
    try {
      succeeded = await onSubmit(n);
      if (succeeded) onClose();
    } catch {
      succeeded = false;
    } finally {
      if (!succeeded) {
        submitInFlightRef.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      clearNav={false}
      zIndexClass="z-[54]"
      title={
        <div>
          <SectionTitle as="h2" className="!text-base">{customer.name}</SectionTitle>
          <Caption className="normal-case">
            {t(lang, "debtBalanceLabel")}: UGX {balance.toLocaleString()}
          </Caption>
        </div>
      }
      footer={
        <div className="space-y-2">
          <WakaButton type="button" className="w-full" loading={submitting} onClick={submit}>
            {t(lang, "repayDebt")}
          </WakaButton>
          <WakaButton type="button" variant="secondary" className="w-full" onClick={onClose}>
            {t(lang, "cancel")}
          </WakaButton>
        </div>
      }
    >
      {quickAmounts.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {quickAmounts.map((chip) => (
            <WakaButton
              key={chip.label}
              type="button"
              variant="secondary"
              className="!min-h-[34px] !rounded-full !px-3 !py-1 !text-xs"
              onClick={() => setAmount(String(chip.value))}
            >
              {chip.label}
            </WakaButton>
          ))}
        </div>
      ) : null}

      <EnterpriseTextField
        label={t(lang, "payDown")}
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 10))}
        inputMode="numeric"
        autoFocus
        pos
      />
    </ModalSheet>
  );
}
