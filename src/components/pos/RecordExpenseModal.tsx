import { useMemo, useState, type FormEvent } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import {
  CASH_EXPENSE_CATEGORY_KEYS,
  canRecordCashExpenses,
  cashExpenseCategoryLabel,
} from "../../lib/cashExpenses";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { dateKeyKampala } from "../../lib/datesUg";
import { EnterpriseTextField } from "../enterprise/EnterpriseTextField";
import { WakaButton } from "../ui/wakaPrimitives";
import { Body, Caption } from "../enterprise/EnterpriseTypography";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
};

export function RecordExpenseModal({ lang, open, onClose }: Props) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const addCashExpense = usePosStore((s) => s.addCashExpense);

  const [amount, setAmount] = useState("");
  const [categoryKey, setCategoryKey] = useState<string>("lunch");
  const [customCategory, setCustomCategory] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const todayKey = dateKeyKampala(new Date());
  const canRecord = canRecordCashExpenses(actor.role, preferences, actor.permissions);

  const myTodayExpenses = useMemo(
    () =>
      cashExpenses
        .filter((e) => !e.deletedAt && e.paidOn === todayKey && e.createdByUserId === actor.userId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [cashExpenses, todayKey, actor.userId],
  );

  if (!open || !canRecord) return null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const category =
      categoryKey === "custom" ? customCategory.trim() : cashExpenseCategoryLabel(lang, categoryKey);
    const res = addCashExpense({
      amountUgx: Math.floor(Number(amount.replace(/\D/g, "")) || 0),
      category,
      description: note.trim(),
    });
    if (!res.ok) {
      setErr(t(lang, res.errorKey === "forbidden" ? "noPermission" : (res.errorKey ?? "invalid")));
      return;
    }
    setSaved(true);
    setAmount("");
    setNote("");
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 900);
  };

  return (
    <ModalSheet open={open} onClose={onClose} title={t(lang, "posRecordExpenseTitle")} align="center">
      <Body className="!text-sm text-muted-foreground">{t(lang, "posRecordExpenseSub")}</Body>
      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <EnterpriseTextField
          label={`${t(lang, "cashExpenseAmount")} *`}
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
          pos
          required
        />
        <label className="block">
          <span className={enterpriseTypeClass("body", "mb-1.5 block !text-sm !font-bold")}>{t(lang, "cashExpenseCategory")} *</span>
          <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} className="min-h-[52px] w-full rounded-2xl border-2 border-border px-4 text-lg font-bold">
            {CASH_EXPENSE_CATEGORY_KEYS.map((k) => (
              <option key={k} value={k}>
                {cashExpenseCategoryLabel(lang, k)}
              </option>
            ))}
            <option value="custom">{t(lang, "cashExpenseCategoryCustom")}</option>
          </select>
        </label>
        {categoryKey === "custom" ? (
          <EnterpriseTextField
            label={t(lang, "cashExpenseCustomName")}
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            required
          />
        ) : null}
        <label className="block">
          <span className={enterpriseTypeClass("body", "mb-1.5 block !text-sm !font-bold")}>{t(lang, "cashExpenseDescription")}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-2 min-h-[72px] w-full rounded-2xl border-2 border-border px-4 py-3 text-sm font-semibold outline-none focus:border-waka-500"
          />
        </label>
        {err ? <Body className="!text-sm text-danger-foreground">{err}</Body> : null}
        {saved ? <Body className="!text-sm text-emerald-700">{t(lang, "cashExpenseSaved")}</Body> : null}
        <div className="flex gap-3 pt-2">
          <WakaButton type="button" variant="secondary" className="flex-1" onClick={onClose}>
            {t(lang, "cancel")}
          </WakaButton>
          <WakaButton type="submit" variant="primary" className="flex-1">
            {t(lang, "cashExpenseRecordBtn")}
          </WakaButton>
        </div>
      </form>

      {myTodayExpenses.length > 0 ? (
        <section className="mt-6 border-t border-border pt-4">
          <Caption as="h3" className="mb-2 block">{t(lang, "posMyExpensesToday")}</Caption>
          <ul className="space-y-2">
            {myTodayExpenses.slice(0, 8).map((e) => (
              <li key={e.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm">
                <Body as="span" className="!text-sm !font-semibold">{e.category}</Body>
                <Caption className="normal-case tabular-nums">
                  UGX {e.amountUgx.toLocaleString()}
                  {e.approvalStatus === "pending" ? ` · ${t(lang, "expenseStatusPending")}` : ""}
                </Caption>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </ModalSheet>
  );
}
