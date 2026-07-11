import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { dateKeyKampala } from "../lib/datesUg";
import { PageHeader } from "../components/layout/PageHeader";
import { ModalSheet } from "../components/layout/ModalSheet";
import { useSessionActor } from "../context/SessionActorContext";
import {
  CASH_EXPENSE_CATEGORY_KEYS,
  canApproveCashExpenses,
  canDeleteCashExpenses,
  canRecordCashExpenses,
  canViewExpenseRow,
  cashExpenseCategoryLabel,
  expenseCountsInDrawer,
} from "../lib/cashExpenses";
import { useDrawerCashForToday } from "../hooks/useDrawerCashForDay";

type Props = { lang: Language };

export function CashExpensesPage({ lang }: Props) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const cashExpenses = usePosStore((s) => s.cashExpenses);
  const drawer = useDrawerCashForToday();
  const addCashExpense = usePosStore((s) => s.addCashExpense);
  const approveCashExpense = usePosStore((s) => s.approveCashExpense);
  const rejectCashExpense = usePosStore((s) => s.rejectCashExpense);
  const voidCashExpense = usePosStore((s) => s.voidCashExpense);

  const [voidExpenseId, setVoidExpenseId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const todayKey = dateKeyKampala(new Date());
  const [amount, setAmount] = useState("");
  const [categoryKey, setCategoryKey] = useState<string>("lunch");
  const [customCategory, setCustomCategory] = useState("");
  const [description, setDescription] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canRecord = canRecordCashExpenses(actor.role, preferences, actor.permissions);
  const canDelete = canDeleteCashExpenses(actor.role);
  const canApprove = canApproveCashExpenses(actor.role);

  const todayExpenses = useMemo(
    () =>
      cashExpenses
        .filter((e) => !e.deletedAt && e.paidOn === todayKey && canViewExpenseRow(actor.role, e, actor.userId))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [cashExpenses, todayKey, actor.role, actor.userId],
  );

  const pendingExpenses = useMemo(
    () => todayExpenses.filter((e) => (e.approvalStatus ?? "approved") === "pending"),
    [todayExpenses],
  );

  const todayExpenseTotal = useMemo(
    () => todayExpenses.filter(expenseCountsInDrawer).reduce((a, e) => a + e.amountUgx, 0),
    [todayExpenses],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const amt = Math.floor(Number(amount.replace(/\D/g, "")) || 0);
    if (amt <= 0) {
      setErr(t(lang, "cashExpenseAmountRequired"));
      return;
    }
    const cat =
      categoryKey === "custom"
        ? customCategory.trim()
        : cashExpenseCategoryLabel(lang, categoryKey);
    if (!cat) {
      setErr(t(lang, "cashExpenseCategoryRequired"));
      return;
    }
    const res = addCashExpense({
      amountUgx: amt,
      category: cat,
      description: description.trim(),
    });
    if (!res.ok) {
      setErr(res.errorKey ? t(lang, res.errorKey) : t(lang, "invalid"));
      return;
    }
    setAmount("");
    setDescription("");
    setCustomCategory("");
    setCategoryKey("lunch");
    setShowForm(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  if (!canRecord) {
    return (
      <div className="space-y-4 pb-8">
        <PageHeader lang={lang} title={t(lang, "cashExpensesTitle")} backLabel={t(lang, "backToSell")} backFallback="/pos" />
        <p className="text-sm font-semibold text-muted-foreground">{t(lang, "noPermission")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        lang={lang}
        title={t(lang, "cashExpensesTitle")}
        subtitle={t(lang, "cashExpensesSub")}
        backLabel={t(lang, "backToSell")}
        backFallback="/pos"
      />

      <section className="rounded-3xl border border-waka-200 bg-waka-50 p-4 shadow-waka-sm">
        <p className="text-[11px] font-black uppercase tracking-wide text-waka-800">{t(lang, "cashExpensesToday")}</p>
        <p className="mt-1 text-2xl font-black text-foreground">UGX {todayExpenseTotal.toLocaleString()}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-white/80 px-3 py-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "cashExpensesCashSales")}</p>
            <p className="font-black text-foreground">UGX {drawer.cashFromSalesUgx.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-white/80 px-3 py-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "cashExpensesExpectedDrawer")}</p>
            <p className="font-black text-emerald-900">UGX {drawer.expectedDrawerCashUgx.toLocaleString()}</p>
          </div>
        </div>
      </section>

      {canApprove && pendingExpenses.length > 0 ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-amber-900">{t(lang, "expensePendingApprovalTitle")}</h2>
          <ul className="mt-3 space-y-2">
            {pendingExpenses.map((e) => (
              <li key={e.id} className="rounded-2xl border border-amber-100 bg-card px-4 py-3">
                <p className="font-bold text-foreground">
                  {e.category} · UGX {e.amountUgx.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.createdByLabel ?? e.createdByUserId} · {new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => approveCashExpense(e.id)}
                    className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white"
                  >
                    {t(lang, "expenseApproveBtn")}
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectCashExpense(e.id)}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-800"
                  >
                    {t(lang, "expenseRejectBtn")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-waka-600 px-4 py-3 text-base font-black text-white shadow-waka-sm"
        >
          <Plus className="h-5 w-5" aria-hidden />
          {t(lang, "cashExpenseRecordBtn")}
        </button>
      ) : null}

      {showForm ? (
        <form onSubmit={submit} className="space-y-4 rounded-3xl border border-border bg-card p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-foreground">{t(lang, "cashExpenseRecordBtn")}</h2>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "cashExpenseAmount")} *
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className="mt-1.5 w-full min-h-[48px] rounded-xl border border-border px-4 py-3 text-base"
              autoFocus
            />
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "cashExpenseCategory")} *
            <select
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value)}
              className="mt-1.5 w-full min-h-[48px] rounded-xl border border-border px-4 py-3 text-base"
            >
              {CASH_EXPENSE_CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {cashExpenseCategoryLabel(lang, k)}
                </option>
              ))}
              <option value="custom">{t(lang, "cashExpenseCategoryCustom")}</option>
            </select>
          </label>
          {categoryKey === "custom" ? (
            <label className="block text-sm font-bold text-foreground">
              {t(lang, "cashExpenseCustomName")}
              <input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                className="mt-1.5 w-full min-h-[48px] rounded-xl border border-border px-4 py-3 text-base"
                placeholder={t(lang, "cashExpenseCustomPlaceholder")}
              />
            </label>
          ) : null}
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "cashExpenseDescription")}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1.5 w-full rounded-xl border border-border px-4 py-3 text-base"
              placeholder={t(lang, "cashExpenseDescriptionPlaceholder")}
            />
          </label>
          <p className="text-xs font-medium text-muted-foreground">
            {t(lang, "cashExpenseRecordedBy")}: {actor.displayName ?? actor.role}
          </p>
          {err ? <p className="text-sm font-medium text-red-600">{err}</p> : null}
          {saved ? <p className="text-sm font-semibold text-emerald-700">{t(lang, "cashExpenseSaved")}</p> : null}
          <div className="flex gap-2">
            <button type="submit" className="min-h-[48px] flex-1 rounded-2xl bg-waka-600 text-sm font-black text-white">
              {t(lang, "save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setErr(null);
              }}
              className="min-h-[48px] rounded-2xl border-2 border-border px-4 text-sm font-black text-foreground"
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </form>
      ) : null}

      <section>
        <h2 className="text-sm font-black uppercase tracking-wide text-muted-foreground">{t(lang, "cashExpensesListToday")}</h2>
        {todayExpenses.length === 0 ? (
          <p className="mt-3 text-sm font-medium text-muted-foreground">{t(lang, "cashExpensesEmpty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {todayExpenses.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
                <div className="min-w-0">
                  <p className="font-bold text-foreground">{e.category}</p>
                  {e.description ? <p className="text-xs text-muted-foreground">{e.description}</p> : null}
                  <p className="text-[10px] font-bold uppercase text-muted-foreground">
                    {e.createdByLabel ?? e.createdByUserId}
                    {(e.approvalStatus ?? "approved") === "pending"
                      ? ` · ${t(lang, "expenseStatusPending")}`
                      : (e.approvalStatus ?? "approved") === "rejected"
                        ? ` · ${t(lang, "expenseStatusRejected")}`
                        : e.approvedByLabel
                          ? ` · ${t(lang, "expenseApprovedBy")} ${e.approvedByLabel}`
                          : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <p className="font-black text-foreground">UGX {e.amountUgx.toLocaleString()}</p>
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => {
                        setVoidExpenseId(e.id);
                        setVoidReason("");
                      }}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-black uppercase text-rose-800"
                    >
                      {t(lang, "voidBtn")}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {voidExpenseId ? (
        <ModalSheet
          open
          onClose={() => setVoidExpenseId(null)}
          zIndexClass="z-50"
          align="center"
          title={t(lang, "cashExpenseVoidConfirm")}
          footer={
            <div className="flex gap-3">
              <button
                type="button"
                className="min-h-[48px] flex-1 rounded-2xl border-2 py-3 font-bold"
                onClick={() => setVoidExpenseId(null)}
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="button"
                className="min-h-[48px] flex-1 rounded-2xl bg-rose-600 py-3 font-black text-white"
                onClick={() => {
                  const r = voidCashExpense(voidExpenseId, voidReason);
                  if (!r.ok) {
                    window.alert(t(lang, r.errorKey === "auditReasonRequired" ? "auditReasonRequired" : (r.errorKey ?? "invalid")));
                    return;
                  }
                  setVoidExpenseId(null);
                  setVoidReason("");
                }}
              >
                {t(lang, "voidBtn")}
              </button>
            </div>
          }
        >
          <label className="block">
            <span className="text-sm font-bold text-foreground">{t(lang, "auditReasonLabel")}</span>
            <textarea
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              className="mt-2 min-h-[80px] w-full rounded-2xl border-2 border-border px-4 py-3 text-sm font-semibold outline-none focus:border-waka-500"
              placeholder={t(lang, "auditReasonPlaceholder")}
            />
          </label>
        </ModalSheet>
      ) : null}

      <p className="text-center">
        <Link to="/close-day" className="text-sm font-bold text-waka-700 underline">
          {t(lang, "closeDay")} →
        </Link>
      </p>
    </div>
  );
}
