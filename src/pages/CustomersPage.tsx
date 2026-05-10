import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";

export function CustomersPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canView = hasPermission(actor.role, "customers.view");
  const canDebt = hasPermission(actor.role, "customers.debt");
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const debtPayments = usePosStore((s) => s.debtPayments);
  const addCustomer = usePosStore((s) => s.addCustomer);
  const addDebtPayment = usePosStore((s) => s.addDebtPayment);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    addCustomer({ name: name.trim(), phone: phone.trim(), location: "Uganda" });
    setName("");
    setPhone("");
  };

  const creditSalesFor = (customerId: string) =>
    sales.filter((s) => s.customerId === customerId && s.debtUgx > 0).length;

  const paymentsFor = (customerId: string) => debtPayments.filter((d) => d.customerId === customerId);

  const submitPay = (customerId: string) => {
    const n = Math.floor(Number(payAmount.replace(/\D/g, "")) || 0);
    const r = addDebtPayment(customerId, n);
    if (r.ok) {
      setPayOpen(null);
      setPayAmount("");
    }
  };

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-5 pb-8">
      <h1 className="text-3xl font-black text-slate-900">{t(lang, "customers")}</h1>
      <p className="text-lg text-slate-600">{t(lang, "customersHelp")}</p>

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
          {t(lang, "addCustomer")}
        </button>
      </form>

      {customers.map((c) => (
        <article key={c.id} className="rounded-3xl border-2 border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-2xl font-black text-slate-900">{c.name}</p>
              <p className="text-slate-500">{c.phone}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold uppercase text-amber-800">{t(lang, "debtBalanceLabel")}</p>
              <p className="text-3xl font-black text-amber-900">UGX {c.debtBalanceUgx.toLocaleString()}</p>
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {t(lang, "creditSalesCount")}: {creditSalesFor(c.id)}
          </p>
          {canDebt ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setPayOpen(payOpen === c.id ? null : c.id);
                  setPayAmount("");
                }}
                className="mt-4 w-full rounded-2xl bg-emerald-600 py-3 text-lg font-black text-white"
              >
                {t(lang, "repayDebt")}
              </button>
              {payOpen === c.id && (
                <div className="mt-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
                  <label className="block font-bold text-emerald-950">{t(lang, "payDown")}</label>
                  <input
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    inputMode="numeric"
                    className="mt-2 w-full rounded-xl border-2 border-emerald-300 px-3 py-3 text-2xl font-black"
                  />
                  <button
                    type="button"
                    onClick={() => submitPay(c.id)}
                    className="mt-3 w-full rounded-xl bg-emerald-700 py-3 font-black text-white"
                  >
                    {t(lang, "saveSale")}
                  </button>
                </div>
              )}
            </>
          ) : null}
          {paymentsFor(c.id).length > 0 && (
            <div className="mt-4">
              <p className="font-bold text-slate-800">{t(lang, "debtHistory")}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {paymentsFor(c.id).map((p) => (
                  <li key={p.id} className="flex justify-between text-slate-600">
                    <span>{new Date(p.createdAt).toLocaleString()}</span>
                    <span className="font-bold text-emerald-800">−UGX {p.amountUgx.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
