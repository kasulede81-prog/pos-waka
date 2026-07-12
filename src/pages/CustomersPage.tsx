import { useMemo, useState } from "react";
import { actorHasPermission } from "../lib/actorAuthorization";
import { Navigate } from "react-router-dom";
import { ChevronDown, FileDown, UserPlus, Users } from "lucide-react";
import clsx from "clsx";
import type { Customer, Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { useShopAction } from "../hooks/useShopAction";
import {
  buildCreditActivityIndex,
  creditActivityTimelineFromIndex,
  filterCreditActivityByBounds,
  findOrphanDebtSales,
  sumCreditIssuedInBounds,
  sumDebtPaymentsInBounds,
  sumOrphanDebtUgx,
} from "../lib/customerDebtActivity";
import { usePosStore } from "../store/usePosStore";
import { usePharmacyTerms } from "../lib/pharmacyTerms";
import { useHospitalityTerms } from "../lib/hospitalityTerms";
import { isHospitalityMode } from "../lib/hospitality";
import { isWholesaleMode } from "../lib/wholesale";
import { useWholesaleTerms } from "../lib/wholesaleTerms";
import { useDeferredSales } from "../hooks/useDeferredSales";
import { useSessionActor } from "../context/SessionActorContext";
import {
  documentReceiptNumber,
  downloadDebtPaymentReceiptPdf,
  printDebtPaymentReceipt,
  shareDebtPaymentReceiptPdf,
  type DebtPaymentReceiptContext,
} from "../lib/receiptDocuments";
import { brandingFromDebtPayment } from "../lib/receiptBranding";
import { useSubscription } from "../context/SubscriptionContext";
import { resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { DocumentActionsBar } from "../components/documents/DocumentActionsBar";
import { ModalSheet } from "../components/layout/ModalSheet";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { VirtualizedCustomerDebtList } from "../components/debts/VirtualizedCustomerDebtList";
import { DebtsStatGrid } from "../components/debts/DebtsStatGrid";
import { DebtsFilterChips } from "../components/debts/DebtsFilterChips";
import { DebtsSearchBar } from "../components/debts/DebtsSearchBar";
import { DebtReceivePaymentSheet } from "../components/debts/DebtReceivePaymentSheet";
import { DebtCustomerDetailSheet } from "../components/debts/DebtCustomerDetailSheet";
import { DebtAddCustomerSheet } from "../components/debts/DebtAddCustomerSheet";
import { SalesHistoryDateFilterChips } from "../components/receipts/SalesHistoryDateFilterChips";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { dateMatchesFilter } from "../lib/dateFilters";
import { dateKeyKampala } from "../lib/datesUg";
import { selectedDayKeyForFilter } from "../lib/dateFilterLabels";
import {
  computeAverageCollectionDays,
  countCustomersOwing,
  countOverdueAccounts,
  customerMatchesQuickFilter,
  customerMatchesSearch,
  type DebtsQuickFilter,
} from "../lib/debtsPageView";
import { shareText } from "../lib/reportExport";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";

export function CustomersPage({ lang }: { lang: Language }) {
  const { run: runShopAction } = useShopAction();
  const actor = useSessionActor();
  const canView = actorHasPermission(actor, "customers.view");
  const canDebt = actorHasPermission(actor, "customers.debt");
  const customers = usePosStore((s) => s.customers);
  const preferences = usePosStore((s) => s.preferences);
  const pt = usePharmacyTerms(lang, preferences.businessType, preferences.pharmacyModeEnabled);
  const ht = useHospitalityTerms(lang, preferences.businessType, preferences.hospitalityModeEnabled);
  const wt = useWholesaleTerms(lang, preferences.businessType);
  const modeTerm = isHospitalityMode(preferences.businessType, preferences.hospitalityModeEnabled)
    ? ht
    : isWholesaleMode(preferences.businessType)
      ? wt
      : pt;
  const sales = useDeferredSales();
  const debtPayments = usePosStore((s) => s.debtPayments);
  const addCustomer = usePosStore((s) => s.addCustomer);
  const addDebtPayment = usePosStore((s) => s.addDebtPayment);
  const assignOrphanDebtSale = usePosStore((s) => s.assignOrphanDebtSale);
  const { filter, setFilter, bounds } = useReportingDateFilter();
  const debtsSearchId = "debts-search-input";

  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<DebtsQuickFilter>("all");
  const [sortBy, setSortBy] = useState<"balance_desc" | "balance_asc" | "name_az">("balance_desc");
  const [orphanOpen, setOrphanOpen] = useState(false);
  const [assignCustomerBySale, setAssignCustomerBySale] = useState<Record<string, string>>({});
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [debtReceiptCtx, setDebtReceiptCtx] = useState<DebtPaymentReceiptContext | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [payCustomer, setPayCustomer] = useState<Customer | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const { snapshot, authMode } = useSubscription();
  const receiptPlanTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);
  const todayKey = dateKeyKampala(new Date());
  const isSingleDay = selectedDayKeyForFilter(filter) != null;

  const orphanDebts = useMemo(() => findOrphanDebtSales(sales), [sales]);
  const orphanDebtTotal = useMemo(() => sumOrphanDebtUgx(sales), [sales]);

  const totalDebtUgx = useMemo(
    () => customers.reduce((sum, c) => sum + Math.max(0, c.debtBalanceUgx ?? 0), 0),
    [customers],
  );

  const collectedUgx = useMemo(
    () => sumDebtPaymentsInBounds(debtPayments, bounds),
    [debtPayments, bounds],
  );

  const creditIssuedUgx = useMemo(
    () => sumCreditIssuedInBounds(sales, bounds),
    [sales, bounds],
  );

  const creditActivityIndex = useMemo(
    () => buildCreditActivityIndex(sales, debtPayments),
    [sales, debtPayments],
  );

  const customersOwing = useMemo(() => countCustomersOwing(customers), [customers]);
  const overdueCount = useMemo(
    () => countOverdueAccounts(customers, creditActivityIndex),
    [customers, creditActivityIndex],
  );
  const avgCollectionDays = useMemo(
    () => computeAverageCollectionDays(debtPayments, creditActivityIndex),
    [debtPayments, creditActivityIndex],
  );

  const filteredCustomers = useMemo(() => {
    let list = customers.filter(
      (c) =>
        customerMatchesSearch(c, searchQuery) &&
        customerMatchesQuickFilter(c, quickFilter, creditActivityIndex, bounds, todayKey),
    );
    list = [...list].sort((a, b) => {
      if (sortBy === "name_az") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (sortBy === "balance_asc") return a.debtBalanceUgx - b.debtBalanceUgx;
      return b.debtBalanceUgx - a.debtBalanceUgx;
    });
    return list;
  }, [customers, searchQuery, quickFilter, creditActivityIndex, bounds, todayKey, sortBy]);

  const detailTimeline = useMemo(() => {
    if (!detailCustomer) return [];
    const full = creditActivityTimelineFromIndex(detailCustomer.id, creditActivityIndex);
    return filterCreditActivityByBounds(full, bounds);
  }, [detailCustomer, creditActivityIndex, bounds]);

  const orphanInRange = useMemo(
    () => orphanDebts.filter((o) => dateMatchesFilter(dateKeyKampala(o.createdAt), bounds)),
    [orphanDebts, bounds],
  );

  const submitPay = async (customerId: string, amountUgx: number): Promise<boolean> => {
    let savedPayment: ReturnType<typeof addDebtPayment>["payment"];
    const r = await runShopAction(
      { lang, action: "customer.debt_payment", permitted: canDebt },
      () => {
        const result = addDebtPayment(customerId, amountUgx);
        if (result.ok && result.payment) savedPayment = result.payment;
        return { ok: result.ok, errorKey: result.errorKey };
      },
    );
    if (r.ok && savedPayment) {
      const customer = usePosStore.getState().customers.find((c) => c.id === customerId);
      if (customer) {
        const branding = brandingFromDebtPayment(savedPayment, preferences, receiptPlanTier);
        setDebtReceiptCtx({
          shopName,
          receiptNumber: documentReceiptNumber("DEBT", savedPayment.id, savedPayment.createdAt),
          payment: savedPayment,
          customer,
          cashier: actor.displayName?.trim() || t(lang, "role_owner"),
          balanceAfterUgx: customer.debtBalanceUgx,
          headerLines: branding.headerLines,
          footerLines: branding.footerLines,
          footerPowered: branding.footerPowered,
          paper: preferences.receiptPaperSize ?? "80mm",
        });
      }
    }
    return r.ok;
  };

  const submitAssignOrphan = (saleId: string) => {
    const customerId = assignCustomerBySale[saleId]?.trim();
    if (!customerId) {
      setAssignMessage(t(lang, "orphanDebtNeedCustomer"));
      return;
    }
    const result = assignOrphanDebtSale(saleId, customerId);
    if (result.ok) {
      setAssignMessage(t(lang, "orphanDebtAssigned"));
      setAssignCustomerBySale((prev) => {
        const next = { ...prev };
        delete next[saleId];
        return next;
      });
    } else {
      setAssignMessage(t(lang, result.errorKey ?? "orphanDebtAssignFailed"));
    }
  };

  const exportDebts = async () => {
    const lines = [
      modeTerm("debts"),
      `${t(lang, "debtsStatOutstanding")}: UGX ${totalDebtUgx.toLocaleString()}`,
      `${t(lang, "debtsStatCustomersOwing")}: ${customersOwing}`,
      `${t(lang, "debtsStatCollectedToday")}: UGX ${collectedUgx.toLocaleString()}`,
      "",
      ...filteredCustomers.map(
        (c) => `${c.name}${c.phone ? ` (${c.phone})` : ""}: UGX ${c.debtBalanceUgx.toLocaleString()}`,
      ),
    ];
    await shareText(lines.join("\n"), modeTerm("debts"));
  };

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  return (
    <EnterprisePageContainer className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <EnterprisePageHeader
            lang={lang}
            title={modeTerm("debts")}
            subtitle={t(lang, "debtsPageSub")}
            backFallback="/office"
            backLabel={t(lang, "officeBackToHub")}
            compact
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-8">
          <button
            type="button"
            onClick={() => document.getElementById(debtsSearchId)?.focus()}
            className="inline-flex min-h-[36px] items-center justify-center rounded-xl border border-border bg-card px-2.5 text-xs font-bold text-muted-foreground shadow-sm active:bg-muted"
          >
            {t(lang, "debtsActionSearch")}
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-xl border border-border bg-card px-2.5 text-xs font-bold text-muted-foreground shadow-sm active:bg-muted"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">{t(lang, "debtsAddPerson")}</span>
          </button>
          {customers.length > 0 ? (
            <button
              type="button"
              onClick={() => void exportDebts()}
              className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-xl border border-border bg-card px-2.5 text-xs font-bold text-waka-700 shadow-sm active:bg-muted"
            >
              <FileDown className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden sm:inline">{t(lang, "salesHistoryExport")}</span>
            </button>
          ) : null}
        </div>
      </div>

      <DebtsStatGrid
        lang={lang}
        outstandingUgx={totalDebtUgx}
        customersOwing={customersOwing}
        collectedUgx={collectedUgx}
        creditSalesUgx={creditIssuedUgx}
        overdueCount={overdueCount}
        avgCollectionDays={avgCollectionDays}
        collectedLabel={
          isSingleDay ? t(lang, "debtsStatCollectedToday") : t(lang, "debtsHeroCollectedInRange")
        }
        creditSalesLabel={
          isSingleDay ? t(lang, "debtsStatCreditSales") : t(lang, "debtsHeroCreditInRange")
        }
      />

      <div className="sticky top-0 z-10 -mx-3 space-y-2 bg-muted/95 px-3 pb-2 pt-0 backdrop-blur-sm sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
        <SalesHistoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />
        <DebtsFilterChips lang={lang} active={quickFilter} onChange={setQuickFilter} />
        <DebtsSearchBar lang={lang} value={searchQuery} onChange={setSearchQuery} inputId={debtsSearchId} />
      </div>

      {orphanDebts.length > 0 ? (
        <details
          open={orphanOpen}
          onToggle={(e) => setOrphanOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="overflow-hidden rounded-2xl border border-rose-200 bg-rose-50/50"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 marker:content-none [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <p className="text-sm font-black text-rose-950">{t(lang, "orphanDebtTitle")}</p>
              <p className="text-xs font-semibold text-rose-800">
                UGX {orphanDebtTotal.toLocaleString()} · {orphanDebts.length}{" "}
                {orphanDebts.length === 1 ? t(lang, "orphanDebtSaleOne") : t(lang, "orphanDebtSaleMany")}
              </p>
            </div>
            <ChevronDown className={clsx("h-5 w-5 shrink-0 text-rose-700 transition-transform", orphanOpen && "rotate-180")} />
          </summary>
          <div className="space-y-2 border-t border-rose-200 px-3 py-3">
            <p className="text-xs text-rose-900">{t(lang, "orphanDebtHelp")}</p>
            {assignMessage ? <p className="text-xs font-bold text-rose-900">{assignMessage}</p> : null}
            <ul className="space-y-2">
              {(orphanInRange.length > 0 ? orphanInRange : orphanDebts).map((o) => (
                <li key={o.saleId} className="rounded-xl border border-rose-200 bg-card p-3">
                  <p className="text-xs font-semibold text-rose-950">
                    {new Date(o.createdAt).toLocaleString()}
                    {o.receiptSeq != null ? ` · #${String(o.receiptSeq).padStart(3, "0")}` : ""}
                  </p>
                  <p className="mt-1 text-base font-black text-rose-950">UGX {o.debtUgx.toLocaleString()}</p>
                  {canDebt && customers.length > 0 ? (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <select
                        value={assignCustomerBySale[o.saleId] ?? ""}
                        onChange={(e) =>
                          setAssignCustomerBySale((prev) => ({ ...prev, [o.saleId]: e.target.value }))
                        }
                        className="min-h-[44px] flex-1 rounded-xl border border-rose-200 bg-card px-3 text-sm font-semibold"
                        aria-label={t(lang, "orphanDebtAssignCustomer")}
                      >
                        <option value="">{t(lang, "orphanDebtAssignCustomer")}</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => submitAssignOrphan(o.saleId)}
                        className="min-h-[44px] rounded-xl bg-rose-900 px-4 text-sm font-black text-white"
                      >
                        {t(lang, "orphanDebtAssign")}
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {customers.length === 0 ? (
        <EnterpriseEmptyState
          icon={Users}
          title={modeTerm("customersEmptyTitle")}
          description={modeTerm("customersEmptySub")}
          primaryAction={{ label: modeTerm("addCustomer"), onClick: () => setAddOpen(true) }}
        />
      ) : null}

      {filteredCustomers.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <h2 className="text-xs font-black text-foreground">
              {tTemplate(lang, "debtsCustomerListTitle", { count: String(filteredCustomers.length) })}
            </h2>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-lg border border-border bg-card px-2 py-1 text-[10px] font-bold text-muted-foreground"
              aria-label={t(lang, "debtsSortBy")}
            >
              <option value="balance_desc">{t(lang, "debtsSortBalanceDesc")}</option>
              <option value="balance_asc">{t(lang, "debtsSortBalanceAsc")}</option>
              <option value="name_az">{t(lang, "debtsSortName")}</option>
            </select>
          </div>
          <VirtualizedCustomerDebtList
            lang={lang}
            customers={filteredCustomers}
            creditIndex={creditActivityIndex}
            canDebt={canDebt}
            onOpenDetail={setDetailCustomer}
            onReceive={setPayCustomer}
          />
        </section>
      ) : customers.length > 0 ? (
        <p className="rounded-xl border border-border bg-muted px-4 py-8 text-center text-sm font-bold text-muted-foreground">
          {t(lang, "posSellNoMatch")}
        </p>
      ) : null}

      <DebtAddCustomerSheet
        lang={lang}
        open={addOpen}
        addLabel={modeTerm("addCustomer")}
        onClose={() => setAddOpen(false)}
        onSubmit={async (name, phone) => {
          const r = await runShopAction({ lang, action: "customer.add", permitted: canView }, () => {
            const row = addCustomer({ name, phone, location: "Uganda" });
            if (row.id === "denied") return { ok: false, errorKey: "forbidden" };
            return { ok: true };
          });
          return r.ok;
        }}
      />

      <DebtReceivePaymentSheet
        lang={lang}
        open={payCustomer !== null}
        customer={payCustomer}
        onClose={() => setPayCustomer(null)}
        onSubmit={async (amount) => (payCustomer ? submitPay(payCustomer.id, amount) : false)}
      />

      <DebtCustomerDetailSheet
        lang={lang}
        open={detailCustomer !== null}
        customer={detailCustomer}
        timeline={detailTimeline}
        onClose={() => setDetailCustomer(null)}
        onReceive={() => detailCustomer && setPayCustomer(detailCustomer)}
        canDebt={canDebt}
      />

      {debtReceiptCtx ? (
        <ModalSheet
          open
          onClose={() => setDebtReceiptCtx(null)}
          zIndexClass="z-[80]"
          clearNav={false}
          title={t(lang, "payDown")}
          footer={
            <button
              type="button"
              className="min-h-[48px] w-full rounded-2xl border-2 border-border py-3 font-bold"
              onClick={() => setDebtReceiptCtx(null)}
            >
              {t(lang, "receiptClose")}
            </button>
          }
        >
          <p className="text-sm text-muted-foreground">{debtReceiptCtx.customer.name}</p>
          <div className="mt-4">
            <DocumentActionsBar
              lang={lang}
              compact
              onPrint={() =>
                void printDebtPaymentReceipt(debtReceiptCtx).then(
                  (r) => !r.ok && window.alert(t(lang, "receiptPdfFailed")),
                )
              }
              onDownloadPdf={() =>
                void downloadDebtPaymentReceiptPdf(debtReceiptCtx).then(
                  (ok) => !ok && window.alert(t(lang, "receiptPdfFailed")),
                )
              }
              onSharePdf={() =>
                void shareDebtPaymentReceiptPdf(debtReceiptCtx).then(
                  (ok) => !ok && window.alert(t(lang, "receiptPdfFailed")),
                )
              }
            />
          </div>
        </ModalSheet>
      ) : null}
    </EnterprisePageContainer>
  );
}
