import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
export function SuppliersPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canView = hasPermission(actor.role, "suppliers.view");
  const canManage = hasPermission(actor.role, "suppliers.manage");

  const suppliers = usePosStore((s) => s.suppliers);
  const addSupplier = usePosStore((s) => s.addSupplier);
  const addSupplierPayment = usePosStore((s) => s.addSupplierPayment);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [payId, setPayId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");

  const sorted = useMemo(() => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);

  if (!canView) {
    return <Navigate to="/" replace />;
  }

  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    addSupplier({ name, phone, location, notes });
    setName("");
    setPhone("");
    setLocation("");
    setNotes("");
  };

  const submitPay = (e: FormEvent) => {
    e.preventDefault();
    if (!payId) return;
    const n = Math.floor(Number(payAmount) || 0);
    const r = addSupplierPayment(payId, n);
    if (r.ok) {
      setPayId(null);
      setPayAmount("");
    }
  };

  const paying = payId ? suppliers.find((s) => s.id === payId) : null;

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-black text-slate-900">{t(lang, "suppliersTitle")}</h1>
        {hasPermission(actor.role, "purchases.record") ? (
          <Link
            to="/restock"
            className="rounded-2xl bg-waka-600 px-4 py-3 text-sm font-black text-white shadow-sm"
          >
            {t(lang, "navRestock")}
          </Link>
        ) : null}
      </div>
      <p className="text-slate-600">{t(lang, "suppliersSub")}</p>

      {canManage ? (
        <form onSubmit={submitAdd} className="space-y-3 rounded-3xl border-2 border-waka-100 bg-waka-50/40 p-5">
          <p className="text-lg font-black text-waka-950">{t(lang, "supplierAddTitle")}</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(lang, "supplierNamePh")}
            required
            className="w-full rounded-2xl border-2 border-waka-200 bg-white px-4 py-3 text-lg"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t(lang, "supplierPhonePh")}
            className="w-full rounded-2xl border-2 border-waka-200 bg-white px-4 py-3"
          />
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t(lang, "supplierLocationPh")}
            className="w-full rounded-2xl border-2 border-waka-200 bg-white px-4 py-3"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t(lang, "supplierNotesPh")}
            className="w-full rounded-2xl border-2 border-waka-200 bg-white px-4 py-3"
          />
          <button type="submit" className="w-full rounded-2xl bg-waka-700 py-4 text-lg font-black text-white">
            {t(lang, "supplierSave")}
          </button>
        </form>
      ) : null}

      <section className="space-y-3">
        {sorted.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600">{t(lang, "suppliersEmpty")}</p>
        ) : (
          sorted.map((s) => (
            <article key={s.id} className="rounded-3xl border-2 border-slate-100 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xl font-black text-slate-900">{s.name}</p>
                  <p className="text-sm text-slate-600">{s.phone || "—"}</p>
                  {s.location ? <p className="text-sm text-slate-500">{s.location}</p> : null}
                  {s.notes ? <p className="mt-2 text-sm text-slate-700">{s.notes}</p> : null}
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold uppercase text-amber-800">{t(lang, "supplierBalanceLabel")}</p>
                  <p className="text-xl font-black text-amber-900">UGX {s.balanceOwedUgx.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t(lang, "supplierTotalBuy")}: UGX {s.totalPurchasesUgx.toLocaleString()}
                  </p>
                </div>
              </div>
              {canManage && s.balanceOwedUgx > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setPayId(s.id);
                    setPayAmount(String(Math.min(s.balanceOwedUgx, 50000)));
                  }}
                  className="mt-4 w-full rounded-2xl border-2 border-amber-300 bg-amber-50 py-3 text-sm font-black text-amber-950"
                >
                  {t(lang, "supplierPayButton")}
                </button>
              ) : null}
            </article>
          ))
        )}
      </section>

      {paying ? (
        <div className="fixed inset-0 z-[56] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal>
          <form
            onSubmit={submitPay}
            className="w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl"
          >
            <p className="text-lg font-black text-slate-900">{t(lang, "supplierPayTitle")}</p>
            <p className="mt-1 text-sm text-slate-600">{paying.name}</p>
            <p className="mt-2 text-sm font-bold text-amber-900">
              {t(lang, "supplierBalanceLabel")}: UGX {paying.balanceOwedUgx.toLocaleString()}
            </p>
            <label className="mt-4 block text-sm font-bold text-slate-700">
              {t(lang, "supplierPayAmount")}
              <input
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                inputMode="numeric"
                className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
              />
            </label>
            <div className="mt-4 flex gap-2">
              <button type="submit" className="flex-1 rounded-2xl bg-waka-600 py-3 font-black text-white">
                {t(lang, "supplierPaySave")}
              </button>
              <button type="button" className="rounded-2xl border-2 px-4 py-3 font-bold" onClick={() => setPayId(null)}>
                {t(lang, "cancel")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
