import { useMemo, useState, type FormEvent } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import {
  CASH_EXPENSE_CATEGORY_KEYS,
  canRecordCashExpenses,
  cashExpenseCategoryLabel,
} from "../../lib/cashExpenses";
import { usePosStore } from "../../store/usePosStore";
import { useSessionActor } from "../../context/SessionActorContext";
import { dateKeyKampala } from "../../lib/datesUg";

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

  const inputClass =
    "mt-2 min-h-[52px] w-full rounded-2xl border-2 border-stone-200 px-4 text-lg font-bold outline-none focus:border-waka-500";

  return (
    <AppModalOverlay className="z-[65] flex items-end justify-center bg-black/50 p-3 sm:items-center" role="dialog" aria-modal>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-black text-stone-900">{t(lang, "posRecordExpenseTitle")}</h2>
        <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "posRecordExpenseSub")}</p>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "cashExpenseAmount")} *
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              className={inputClass}
              required
            />
          </label>
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "cashExpenseCategory")} *
            <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} className={inputClass}>
              {CASH_EXPENSE_CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {cashExpenseCategoryLabel(lang, k)}
                </option>
              ))}
              <option value="custom">{t(lang, "cashExpenseCategoryCustom")}</option>
            </select>
          </label>
          {categoryKey === "custom" ? (
            <label className="block text-sm font-bold text-stone-800">
              {t(lang, "cashExpenseCustomName")}
              <input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} className={inputClass} required />
            </label>
          ) : null}
          <label className="block text-sm font-bold text-stone-800">
            {t(lang, "cashExpenseDescription")}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-2 min-h-[72px] w-full rounded-2xl border-2 border-stone-200 px-4 py-3 text-sm font-semibold outline-none focus:border-waka-500"
            />
          </label>
          {err ? <p className="text-sm font-bold text-rose-700">{err}</p> : null}
          {saved ? <p className="text-sm font-bold text-emerald-700">{t(lang, "cashExpenseSaved")}</p> : null}
          <div className="flex gap-3 pt-2">
            <button type="button" className="flex-1 rounded-2xl border-2 py-3 font-bold" onClick={onClose}>
              {t(lang, "cancel")}
            </button>
            <button type="submit" className="flex-1 rounded-2xl bg-waka-600 py-3 font-black text-white">
              {t(lang, "cashExpenseRecordBtn")}
            </button>
          </div>
        </form>

        {myTodayExpenses.length > 0 ? (
          <section className="mt-6 border-t border-stone-100 pt-4">
            <h3 className="text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "posMyExpensesToday")}</h3>
            <ul className="mt-2 space-y-2">
              {myTodayExpenses.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-sm">
                  <span className="font-semibold text-stone-800">{e.category}</span>
                  <span className="font-black text-stone-900">
                    UGX {e.amountUgx.toLocaleString()}
                    {e.approvalStatus === "pending" ? ` · ${t(lang, "expenseStatusPending")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </AppModalOverlay>
  );
}
