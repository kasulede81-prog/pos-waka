import { useEffect, useMemo, useState } from "react";
import type { Customer, Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";

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

  useEffect(() => {
    if (!open) setAmount("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const balance = customer?.debtBalanceUgx ?? 0;

  const quickAmounts = useMemo(() => {
    if (balance <= 0) return [];
    return [
      ...QUICK_PCTS.map((pct) => ({ label: `${pct}%`, value: Math.max(1, Math.round((balance * pct) / 100)) })),
      { label: t(lang, "debtsPayFull"), value: balance },
    ];
  }, [balance, lang]);

  if (!open || !customer) return null;

  const submit = async () => {
    const n = Math.floor(Number(amount.replace(/\D/g, "")) || 0);
    if (n <= 0) return;
    const ok = await onSubmit(n);
    if (ok) onClose();
  };

  return (
    <AppModalOverlay className="z-[54] flex items-end bg-foreground/40 backdrop-blur-[2px]" clearNav={false}>
      <button type="button" className="absolute inset-0" aria-label={t(lang, "cancel")} onClick={onClose} />
      <div className="relative z-[55] w-full rounded-t-[1.75rem] border border-border bg-card px-4 pb-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+1rem)] pt-3 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" aria-hidden />
        <p className="text-sm font-black text-foreground">{customer.name}</p>
        <p className="text-xs font-semibold text-muted-foreground">
          {t(lang, "debtBalanceLabel")}: UGX {balance.toLocaleString()}
        </p>

        {quickAmounts.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {quickAmounts.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => setAmount(String(chip.value))}
                className="min-h-[34px] rounded-full border border-border bg-muted px-3 text-xs font-bold text-foreground active:bg-waka-50 active:border-waka-300"
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}

        <label className="mt-3 block">
          <span className="text-xs font-bold text-muted-foreground">{t(lang, "payDown")}</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="numeric"
            autoFocus
            className="mt-1.5 h-12 w-full rounded-xl border border-border px-3 text-xl font-black tabular-nums outline-none focus:border-waka-400 focus:ring-2 focus:ring-waka-200/80"
          />
        </label>

        <button
          type="button"
          onClick={submit}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-waka-600 text-sm font-black text-white active:bg-waka-700"
        >
          {t(lang, "repayDebt")}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-border text-sm font-bold text-muted-foreground active:bg-muted"
        >
          {t(lang, "cancel")}
        </button>
      </div>
    </AppModalOverlay>
  );
}
