import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Plus, Receipt } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { dateKeyKampala } from "../lib/datesUg";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";
import { EnterpriseKpiCard } from "../components/enterprise/EnterpriseKpiCard";
import { EnterpriseTextField } from "../components/enterprise/EnterpriseTextField";
import { EnterpriseResponsiveTable } from "../components/shared/ResponsiveDataTable";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { Body, Caption, MonoNumber, SectionTitle } from "../components/enterprise/EnterpriseTypography";
import { ModalSheet } from "../components/layout/ModalSheet";
import { statusTokens } from "../lib/statusTokens";
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
import { enterpriseTypeClass } from "../lib/enterpriseTypography";
import { Banknote, TrendingDown, Wallet } from "lucide-react";

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
      <EnterprisePageContainer>
        <EnterprisePageHeader lang={lang} title={t(lang, "cashExpensesTitle")} backLabel={t(lang, "backToSell")} backFallback="/pos" />
        <Body className="text-muted-foreground">{t(lang, "noPermission")}</Body>
      </EnterprisePageContainer>
    );
  }

  return (
    <EnterprisePageContainer>
      <EnterprisePageHeader
        lang={lang}
        title={t(lang, "cashExpensesTitle")}
        subtitle={t(lang, "cashExpensesSub")}
        backLabel={t(lang, "backToSell")}
        backFallback="/pos"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <EnterpriseKpiCard
          icon={Receipt}
          label={t(lang, "cashExpensesToday")}
          tone="highlight"
          value={<MonoNumber className="text-lg">UGX {todayExpenseTotal.toLocaleString()}</MonoNumber>}
        />
        <EnterpriseKpiCard
          icon={TrendingDown}
          label={t(lang, "cashExpensesCashSales")}
          value={<MonoNumber className="text-base">UGX {drawer.cashFromSalesUgx.toLocaleString()}</MonoNumber>}
        />
        <EnterpriseKpiCard
          icon={Wallet}
          label={t(lang, "cashExpensesExpectedDrawer")}
          tone="success"
          value={<MonoNumber className="text-base text-emerald-800">UGX {drawer.expectedDrawerCashUgx.toLocaleString()}</MonoNumber>}
        />
      </div>

      {canApprove && pendingExpenses.length > 0 ? (
        <EnterpriseCard
          title={t(lang, "expensePendingApprovalTitle")}
          className={clsx(statusTokens.warning.banner, statusTokens.warning.badgeRing)}
        >
          <ul className="space-y-2">
            {pendingExpenses.map((e) => (
              <li key={e.id} className={clsx("rounded-2xl border bg-card px-4 py-3", statusTokens.warning.badgeRing)}>
                <Body className="!font-bold">
                  {e.category} · UGX {e.amountUgx.toLocaleString()}
                </Body>
                <Caption className="mt-0.5 block normal-case">
                  {e.createdByLabel ?? e.createdByUserId} · {new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </Caption>
                <div className="mt-2 flex gap-2">
                  <WakaButton type="button" variant="primary" onClick={() => approveCashExpense(e.id)}>
                    {t(lang, "expenseApproveBtn")}
                  </WakaButton>
                  <WakaButton
                    type="button"
                    variant="secondary"
                    className={clsx(statusTokens.danger.badgeRing, statusTokens.danger.banner)}
                    onClick={() => rejectCashExpense(e.id)}
                  >
                    {t(lang, "expenseRejectBtn")}
                  </WakaButton>
                </div>
              </li>
            ))}
          </ul>
        </EnterpriseCard>
      ) : null}

      {!showForm ? (
        <WakaButton type="button" variant="primary" size="pos" className="w-full" iconLeft={<Plus className="h-5 w-5" />} onClick={() => setShowForm(true)}>
          {t(lang, "cashExpenseRecordBtn")}
        </WakaButton>
      ) : null}

      {showForm ? (
        <EnterpriseCard title={t(lang, "cashExpenseRecordBtn")}>
          <form onSubmit={submit} className="space-y-4">
            <EnterpriseTextField
              label={`${t(lang, "cashExpenseAmount")} *`}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              pos
              autoFocus
            />
            <label className="block">
              <span className={enterpriseTypeClass("body", "mb-1.5 block !text-sm !font-bold")}>{t(lang, "cashExpenseCategory")} *</span>
              <select
                value={categoryKey}
                onChange={(e) => setCategoryKey(e.target.value)}
                className="min-h-[48px] w-full rounded-xl border border-border bg-card px-4 py-3 text-base"
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
              <EnterpriseTextField
                label={t(lang, "cashExpenseCustomName")}
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder={t(lang, "cashExpenseCustomPlaceholder")}
              />
            ) : null}
            <label className="block">
              <span className={enterpriseTypeClass("body", "mb-1.5 block !text-sm !font-bold")}>{t(lang, "cashExpenseDescription")}</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-border px-4 py-3 text-base"
                placeholder={t(lang, "cashExpenseDescriptionPlaceholder")}
              />
            </label>
            <Caption className="normal-case">
              {t(lang, "cashExpenseRecordedBy")}: {actor.displayName ?? actor.role}
            </Caption>
            {err ? <Body className="!text-sm text-danger-foreground">{err}</Body> : null}
            {saved ? <Body className="!text-sm text-emerald-700">{t(lang, "cashExpenseSaved")}</Body> : null}
            <div className="flex gap-2">
              <WakaButton type="submit" variant="primary" className="flex-1">
                {t(lang, "save")}
              </WakaButton>
              <WakaButton
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowForm(false);
                  setErr(null);
                }}
              >
                {t(lang, "cancel")}
              </WakaButton>
            </div>
          </form>
        </EnterpriseCard>
      ) : null}

      <section>
        <SectionTitle as="h2" className="mb-2 !text-xs uppercase tracking-wide text-muted-foreground">
          {t(lang, "cashExpensesListToday")}
        </SectionTitle>
        {todayExpenses.length === 0 ? (
          <EnterpriseEmptyState icon={Banknote} title={t(lang, "cashExpensesEmpty")} />
        ) : (
          <EnterpriseResponsiveTable
            rows={todayExpenses}
            rowKey={(e) => e.id}
            minWidthPx={560}
            columns={[
              {
                id: "category",
                header: t(lang, "cashExpenseCategory"),
                cell: (e) => (
                  <div>
                    <Body as="span" className="!text-sm !font-bold">{e.category}</Body>
                    {e.description ? <Caption className="mt-0.5 block normal-case">{e.description}</Caption> : null}
                    <Caption className="mt-0.5 block normal-case">
                      {e.createdByLabel ?? e.createdByUserId}
                      {(e.approvalStatus ?? "approved") === "pending"
                        ? ` · ${t(lang, "expenseStatusPending")}`
                        : (e.approvalStatus ?? "approved") === "rejected"
                          ? ` · ${t(lang, "expenseStatusRejected")}`
                          : e.approvedByLabel
                            ? ` · ${t(lang, "expenseApprovedBy")} ${e.approvedByLabel}`
                            : ""}
                    </Caption>
                  </div>
                ),
              },
              {
                id: "amount",
                header: t(lang, "cashExpenseAmount"),
                className: "text-right",
                cell: (e) => <MonoNumber>UGX {e.amountUgx.toLocaleString()}</MonoNumber>,
              },
              {
                id: "void",
                header: "",
                cell: (e) =>
                  canDelete ? (
                    <WakaButton
                      type="button"
                      variant="secondary"
                      size="standard"
                      className={clsx("!text-xs", statusTokens.danger.badgeRing)}
                      onClick={() => {
                        setVoidExpenseId(e.id);
                        setVoidReason("");
                      }}
                    >
                      {t(lang, "voidBtn")}
                    </WakaButton>
                  ) : null,
              },
            ]}
          />
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
              <WakaButton type="button" variant="secondary" className="flex-1" onClick={() => setVoidExpenseId(null)}>
                {t(lang, "cancel")}
              </WakaButton>
              <WakaButton
                type="button"
                variant="danger"
                className="flex-1"
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
              </WakaButton>
            </div>
          }
        >
          <label className="block">
            <span className={enterpriseTypeClass("body", "mb-1.5 block !text-sm !font-bold")}>{t(lang, "auditReasonLabel")}</span>
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
    </EnterprisePageContainer>
  );
}
