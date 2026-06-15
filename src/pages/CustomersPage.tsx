import { useMemo, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  buildCreditActivityTimeline,
  findOrphanDebtSales,
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

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [assignCustomerBySale, setAssignCustomerBySale] = useState<Record<string, string>>({});
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [debtReceiptCtx, setDebtReceiptCtx] = useState<DebtPaymentReceiptContext | null>(null);
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const { snapshot, authMode } = useSubscription();
  const receiptPlanTier = authMode === "local" ? "waka_plus" : resolveEffectivePlanTier(snapshot);

  const orphanDebts = useMemo(() => findOrphanDebtSales(sales), [sales]);
  const orphanDebtTotal = useMemo(() => sumOrphanDebtUgx(sales), [sales]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    addCustomer({ name: name.trim(), phone: phone.trim(), location: "Uganda" });
    setName("");
    setPhone("");
  };

  const submitPay = (customerId: string) => {
    const n = Math.floor(Number(payAmount.replace(/\D/g, "")) || 0);
    const r = addDebtPayment(customerId, n);
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
      setPayOpen(null);
      setPayAmount("");
    }
  };

  const paymentsFor = (customerId: string) => debtPayments.filter((d) => d.customerId === customerId);

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

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-5 pb-8">
      <h1 className="text-3xl font-black text-slate-900">{modeTerm("debts")}</h1>
      <p className="text-lg text-slate-600">{t(lang, "debtsHelp")}</p>

      {orphanDebts.length > 0 ? (
        <section className="rounded-3xl border-2 border-red-200 bg-red-50 p-5">
          <p className="text-lg font-black text-red-950">{t(lang, "orphanDebtTitle")}</p>
          <p className="mt-2 text-sm text-red-900">{t(lang, "orphanDebtHelp")}</p>
          <p className="mt-3 text-2xl font-black text-red-950">
            UGX {orphanDebtTotal.toLocaleString()} · {orphanDebts.length}{" "}
            {orphanDebts.length === 1 ? t(lang, "orphanDebtSaleOne") : t(lang, "orphanDebtSaleMany")}
          </p>
          {assignMessage ? <p className="mt-2 text-sm font-bold text-red-900">{assignMessage}</p> : null}
          <ul className="mt-3 space-y-3">
            {orphanDebts.map((o) => (
              <li key={o.saleId} className="rounded-2xl border border-red-200 bg-white/80 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-red-950">
                      {new Date(o.createdAt).toLocaleString()}
                      {o.receiptSeq != null ? ` · #${o.receiptSeq}` : ""}
                    </p>
                    <p className="mt-1 text-lg font-black text-red-950">UGX {o.debtUgx.toLocaleString()}</p>
                  </div>
                </div>
                {canDebt && customers.length > 0 ? (
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <select
                      value={assignCustomerBySale[o.saleId] ?? ""}
                      onChange={(e) =>
                        setAssignCustomerBySale((prev) => ({ ...prev, [o.saleId]: e.target.value }))
                      }
                      className="min-h-[44px] flex-1 rounded-xl border-2 border-red-200 bg-white px-3 text-sm font-semibold text-slate-900"
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
        </section>
      ) : null}

      {customers.length === 0 ? (
        <section className="rounded-3xl border-2 border-dashed border-amber-200 bg-amber-50/50 p-6 text-center">
          <p className="text-xl font-black text-slate-900">{modeTerm("customersEmptyTitle")}</p>
          <p className="mt-2 text-base text-slate-700">{modeTerm("customersEmptySub")}</p>
        </section>
      ) : null}

      <form onSubmit={submit} className="space-y-3 rounded-3xl border-2 border-slate-100 bg-white p-5">
        <p className="font-black text-slate-900">{t(lang, "addPersonShort")}</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(lang, "personNamePh")}
          required
          className="w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t(lang, "personPhonePh")}
          className="w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
        />
        <button type="submit" className="w-full rounded-2xl bg-slate-900 py-4 text-lg font-black text-white">
          {modeTerm("addCustomer")}
        </button>
      </form>

      {customers.map((c) => {
        const timeline = buildCreditActivityTimeline(c.id, sales, debtPayments);
        const repaymentOnly = paymentsFor(c.id);
        return (
          <article key={c.id} className="rounded-3xl border-2 border-slate-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-2xl font-black text-slate-900">{c.name}</p>
                <p className="text-slate-500">{c.phone || t(lang, "debtNoPhone")}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold uppercase text-amber-800">{t(lang, "debtBalanceLabel")}</p>
                <p className="text-3xl font-black text-amber-900">UGX {c.debtBalanceUgx.toLocaleString()}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
              <p className="font-bold text-slate-900">{t(lang, "creditActivityTitle")}</p>
              <p className="mt-1 text-sm text-slate-600">
                {t(lang, "creditActivityBalance")}: UGX {c.debtBalanceUgx.toLocaleString()}
              </p>
              {timeline.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">{t(lang, "creditActivityEmpty")}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {timeline.map((entry) => (
                    <li
                      key={`${entry.kind}-${entry.id}`}
                      className="flex items-start justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-bold text-slate-800">
                          {entry.kind === "credit_sale"
                            ? t(lang, "creditSaleActivity")
                            : t(lang, "debtPaymentActivity")}
                          {entry.receiptSeq != null ? ` #${entry.receiptSeq}` : ""}
                        </p>
                        <p className="text-slate-500">{new Date(entry.at).toLocaleString()}</p>
                      </div>
                      <span
                        className={`shrink-0 font-black ${
                          entry.deltaUgx >= 0 ? "text-amber-900" : "text-waka-800"
                        }`}
                      >
                        {entry.deltaUgx >= 0 ? "+" : "−"}UGX {entry.amountUgx.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canDebt ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setPayOpen(payOpen === c.id ? null : c.id);
                    setPayAmount("");
                  }}
                  className="mt-4 w-full rounded-2xl bg-waka-600 py-3 text-lg font-black text-white"
                >
                  {t(lang, "repayDebt")}
                </button>
                {payOpen === c.id && (
                  <div className="mt-4 rounded-2xl border-2 border-waka-200 bg-waka-50 p-4">
                    <label className="block font-bold text-waka-950">{t(lang, "payDown")}</label>
                    <input
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      inputMode="numeric"
                      className="mt-2 w-full rounded-xl border-2 border-waka-300 px-3 py-3 text-2xl font-black"
                    />
                    <button
                      type="button"
                      onClick={() => submitPay(c.id)}
                      className="mt-3 w-full rounded-xl bg-waka-700 py-3 font-black text-white"
                    >
                      {t(lang, "saveSale")}
                    </button>
                  </div>
                )}
              </>
            ) : null}

            {repaymentOnly.length > 0 ? (
              <div className="mt-4">
                <p className="font-bold text-slate-800">{t(lang, "repaymentHistory")}</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {repaymentOnly.map((p) => (
                    <li key={p.id} className="flex justify-between text-slate-600">
                      <span>{new Date(p.createdAt).toLocaleString()}</span>
                      <span className="font-bold text-waka-800">−UGX {p.amountUgx.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        );
      })}

      {debtReceiptCtx ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal>
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-black text-stone-900">{t(lang, "payDown")}</h2>
            <p className="mt-1 text-sm text-stone-600">{debtReceiptCtx.customer.name}</p>
            <div className="mt-4">
              <DocumentActionsBar
                lang={lang}
                compact
                onPrint={() => void printDebtPaymentReceipt(debtReceiptCtx).then((r) => !r.ok && window.alert(t(lang, "receiptPdfFailed")))}
                onDownloadPdf={() =>
                  void downloadDebtPaymentReceiptPdf(debtReceiptCtx).then((ok) => !ok && window.alert(t(lang, "receiptPdfFailed")))
                }
                onSharePdf={() =>
                  void shareDebtPaymentReceiptPdf(debtReceiptCtx).then((ok) => !ok && window.alert(t(lang, "receiptPdfFailed")))
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
