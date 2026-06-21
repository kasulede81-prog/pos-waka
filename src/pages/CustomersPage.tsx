import { useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ChevronDown, Plus } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  buildCreditActivityIndex,
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
import { hasPermission } from "../lib/permissions";
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
import { DebtsHeroCard } from "../components/debts/DebtsHeroCard";
import { DebtCustomerRow } from "../components/debts/DebtCustomerRow";
import { VirtualizedCustomerDebtList } from "../components/debts/VirtualizedCustomerDebtList";
import { useReportingDateFilter } from "../hooks/useReportingDateFilter";
import { dateMatchesFilter } from "../lib/dateFilters";
import { dateKeyKampala } from "../lib/datesUg";

export function CustomersPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canView = hasPermission(actor.role, "customers.view");
  const canDebt = hasPermission(actor.role, "customers.debt");
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

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [orphanOpen, setOrphanOpen] = useState(false);
  const [assignCustomerBySale, setAssignCustomerBySale] = useState<Record<string, string>>({});
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [debtReceiptCtx, setDebtReceiptCtx] = useState<DebtPaymentReceiptContext | null>(null);
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const { snapshot, authMode } = useSubscription();
  const receiptPlanTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);

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

  const sortedCustomers = useMemo(() => {
    return [...customers].sort((a, b) => {
      if (b.debtBalanceUgx !== a.debtBalanceUgx) return b.debtBalanceUgx - a.debtBalanceUgx;
      return a.name.localeCompare(b.name);
    });
  }, [customers]);

  const creditActivityIndex = useMemo(
    () => buildCreditActivityIndex(sales, debtPayments),
    [sales, debtPayments],
  );

  const useVirtualCustomerList = sortedCustomers.length > 80;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    addCustomer({ name: name.trim(), phone: phone.trim(), location: "Uganda" });
    setName("");
    setPhone("");
  };

  const submitPay = (customerId: string, amountUgx: number) => {
    const r = addDebtPayment(customerId, amountUgx);
    if (r.ok && r.payment) {
      const customer = usePosStore.getState().customers.find((c) => c.id === customerId);
      if (customer) {
        const branding = brandingFromDebtPayment(r.payment, preferences, receiptPlanTier);
        setDebtReceiptCtx({
          shopName,
          receiptNumber: documentReceiptNumber("DEBT", r.payment.id, r.payment.createdAt),
          payment: r.payment,
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

  const orphanInRange = useMemo(
    () => orphanDebts.filter((o) => dateMatchesFilter(dateKeyKampala(o.createdAt), bounds)),
    [orphanDebts, bounds],
  );

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{modeTerm("debts")}</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">{t(lang, "debtsHelp")}</p>
      </div>

      <DebtsHeroCard
        lang={lang}
        totalDebtUgx={totalDebtUgx}
        collectedUgx={collectedUgx}
        creditIssuedUgx={creditIssuedUgx}
        filter={filter}
        onFilterChange={setFilter}
      />

      {orphanDebts.length > 0 ? (
        <details
          open={orphanOpen}
          onToggle={(e) => setOrphanOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="overflow-hidden rounded-[1.35rem] border-2 border-red-200 bg-red-50"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <p className="text-sm font-black text-red-950">{t(lang, "orphanDebtTitle")}</p>
              <p className="text-xs font-semibold text-red-800">
                UGX {orphanDebtTotal.toLocaleString()} · {orphanDebts.length}{" "}
                {orphanDebts.length === 1 ? t(lang, "orphanDebtSaleOne") : t(lang, "orphanDebtSaleMany")}
              </p>
            </div>
            <ChevronDown className={`h-5 w-5 shrink-0 text-red-700 transition-transform ${orphanOpen ? "rotate-180" : ""}`} />
          </summary>
          <div className="space-y-3 border-t border-red-200 px-4 py-3">
            <p className="text-xs text-red-900">{t(lang, "orphanDebtHelp")}</p>
            {assignMessage ? <p className="text-xs font-bold text-red-900">{assignMessage}</p> : null}
            <ul className="space-y-2">
              {(orphanInRange.length > 0 ? orphanInRange : orphanDebts).map((o) => (
                <li key={o.saleId} className="rounded-xl border border-red-200 bg-white/90 p-3">
                  <p className="text-xs font-semibold text-red-950">
                    {new Date(o.createdAt).toLocaleString()}
                    {o.receiptSeq != null ? ` · #${String(o.receiptSeq).padStart(3, "0")}` : ""}
                  </p>
                  <p className="mt-1 text-base font-black text-red-950">UGX {o.debtUgx.toLocaleString()}</p>
                  {canDebt && customers.length > 0 ? (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <select
                        value={assignCustomerBySale[o.saleId] ?? ""}
                        onChange={(e) =>
                          setAssignCustomerBySale((prev) => ({ ...prev, [o.saleId]: e.target.value }))
                        }
                        className="min-h-[44px] flex-1 rounded-xl border border-red-200 bg-white px-3 text-sm font-semibold"
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
                        className="min-h-[44px] rounded-xl bg-red-900 px-4 text-sm font-black text-white"
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

      <details className="rounded-[1.35rem] border border-stone-200 bg-white shadow-waka-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 text-sm font-black text-slate-900">
            <Plus className="h-4 w-4 text-waka-600" aria-hidden />
            {t(lang, "debtsAddPerson")}
          </span>
          <ChevronDown className="h-5 w-5 text-stone-400" />
        </summary>
        <form onSubmit={submit} className="space-y-3 border-t border-stone-100 px-4 py-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(lang, "personNamePh")}
            required
            className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-semibold"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t(lang, "personPhonePh")}
            className="w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-semibold"
          />
          <button type="submit" className="w-full rounded-xl bg-slate-900 py-3 text-base font-black text-white">
            {modeTerm("addCustomer")}
          </button>
        </form>
      </details>

      {customers.length === 0 ? (
        <section className="rounded-[1.35rem] border border-dashed border-amber-200 bg-amber-50/50 p-6 text-center">
          <p className="text-lg font-black text-slate-900">{modeTerm("customersEmptyTitle")}</p>
          <p className="mt-1 text-sm text-slate-600">{modeTerm("customersEmptySub")}</p>
        </section>
      ) : null}

      {sortedCustomers.length > 0 ? (
        <section className="rounded-[1.35rem] border border-stone-200 bg-white shadow-waka-sm">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <h2 className="text-base font-black text-slate-950">{modeTerm("customers")}</h2>
            <p className="text-xs font-bold text-slate-500">{sortedCustomers.length}</p>
          </div>
          {useVirtualCustomerList ? (
            <VirtualizedCustomerDebtList
              lang={lang}
              customers={sortedCustomers}
              creditIndex={creditActivityIndex}
              bounds={bounds}
              canDebt={canDebt}
              onSubmitPay={submitPay}
            />
          ) : (
            sortedCustomers.map((c, index) => (
              <DebtCustomerRow
                key={c.id}
                lang={lang}
                customer={c}
                creditIndex={creditActivityIndex}
                bounds={bounds}
                canDebt={canDebt}
                toneIndex={index}
                onSubmitPay={submitPay}
              />
            ))
          )}
        </section>
      ) : null}

      {debtReceiptCtx ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-black text-stone-900">{t(lang, "payDown")}</h2>
            <p className="mt-1 text-sm text-stone-600">{debtReceiptCtx.customer.name}</p>
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
            <button
              type="button"
              className="mt-4 w-full rounded-2xl border-2 border-stone-200 py-3 font-bold"
              onClick={() => setDebtReceiptCtx(null)}
            >
              {t(lang, "receiptClose")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
