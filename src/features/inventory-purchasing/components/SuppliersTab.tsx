import { useMemo, useState, type FormEvent } from "react";
import { actorHasPermission } from "../../../lib/actorAuthorization";
import clsx from "clsx";
import { Phone, MessageCircle } from "lucide-react";
import type { Language, Supplier } from "../../../types";
import { t } from "../../../lib/i18n";
import { usePosStore } from "../../../store/usePosStore";
import { useSessionActor } from "../../../context/SessionActorContext";

import { ModalSheet } from "../../../components/layout/ModalSheet";
import { isWalkInSupplierId } from "../../../lib/walkInSupplier";
import { formatShortUgx } from "../lib/overviewStats";

type Props = {
  lang: Language;
  onOpenSupplier: (id: string) => void;
};

export function SuppliersTab({ lang, onOpenSupplier }: Props) {
  const actor = useSessionActor();
  const canManage = actorHasPermission(actor, "suppliers.manage");
  const suppliers = usePosStore((s) => s.suppliers);
  const purchases = usePosStore((s) => s.purchases);
  const addSupplier = usePosStore((s) => s.addSupplier);
  const addSupplierPayment = usePosStore((s) => s.addSupplierPayment);

  const [searchQ, setSearchQ] = useState("");
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [alpha, setAlpha] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [paySupplier, setPaySupplier] = useState<Supplier | null>(null);
  const [payAmount, setPayAmount] = useState("");

  const lastPurchaseBySupplier = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of purchases) {
      if (isWalkInSupplierId(p.supplierId)) continue;
      const prev = map.get(p.supplierId);
      if (!prev || p.createdAt > prev) map.set(p.supplierId, p.createdAt);
    }
    return map;
  }, [purchases]);

  const filtered = useMemo(() => {
    let list = suppliers.filter((s) => !isWalkInSupplierId(s.id));
    const q = searchQ.trim().toLowerCase();
    if (q) list = list.filter((s) => [s.name, s.phone, s.location].join(" ").toLowerCase().includes(q));
    if (outstandingOnly) list = list.filter((s) => s.balanceOwedUgx > 0);
    if (alpha !== "all") list = list.filter((s) => s.name.toUpperCase().startsWith(alpha));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, searchQ, outstandingOnly, alpha]);

  const letters = useMemo(() => {
    const set = new Set<string>();
    for (const s of suppliers) {
      if (isWalkInSupplierId(s.id)) continue;
      const c = s.name.trim()[0]?.toUpperCase();
      if (c) set.add(c);
    }
    return [...set].sort();
  }, [suppliers]);

  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    addSupplier({ name, phone, location, notes });
    setName("");
    setPhone("");
    setLocation("");
    setNotes("");
    setAddOpen(false);
  };

  const submitPay = (e: FormEvent) => {
    e.preventDefault();
    if (!paySupplier) return;
    const n = Math.floor(Number(payAmount) || 0);
    const r = addSupplierPayment(paySupplier.id, n);
    if (r.ok) {
      setPaySupplier(null);
      setPayAmount("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canManage ? (
          <button type="button" onClick={() => setAddOpen(true)} className="rounded-xl bg-waka-600 px-4 py-2 text-xs font-black text-white">
            + {t(lang, "ipActionAddSupplier")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOutstandingOnly((v) => !v)}
          className={clsx(
            "rounded-xl px-3 py-2 text-xs font-black",
            outstandingOnly ? "bg-rose-100 text-rose-900" : "border border-stone-200 bg-white text-stone-800",
          )}
        >
          {t(lang, "ipFilterOutstanding")}
        </button>
      </div>

      <input
        value={searchQ}
        onChange={(e) => setSearchQ(e.target.value)}
        placeholder={t(lang, "ipSuppliersSearchPh")}
        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold shadow-sm"
      />

      <div className="flex gap-1 overflow-x-auto pb-1">
        <button type="button" onClick={() => setAlpha("all")} className={clsx("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black", alpha === "all" ? "bg-waka-600 text-white" : "bg-stone-100 text-stone-700")}>
          {t(lang, "ipFilterAll")}
        </button>
        {letters.map((l) => (
          <button key={l} type="button" onClick={() => setAlpha(l)} className={clsx("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black", alpha === l ? "bg-waka-600 text-white" : "bg-stone-100 text-stone-700")}>
            {l}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm font-semibold text-stone-500">
          {t(lang, "suppliersEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s) => (
            <li key={s.id}>
              <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => onOpenSupplier(s.id)} className="min-w-0 text-left">
                    <p className="text-base font-black text-stone-950">{s.name}</p>
                    <p className="text-sm text-stone-600">{s.phone || "—"}</p>
                    {s.location ? <p className="text-xs text-stone-500">{s.location}</p> : null}
                  </button>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase text-amber-800">{t(lang, "supplierBalanceLabel")}</p>
                    <p className="text-lg font-black tabular-nums text-amber-900">{formatShortUgx(s.balanceOwedUgx)}</p>
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <dt className="font-semibold text-stone-500">{t(lang, "supplierTotalBuy")}</dt>
                    <dd className="font-black">{formatShortUgx(s.totalPurchasesUgx)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-stone-500">{t(lang, "ipLastPurchase")}</dt>
                    <dd className="font-black">{lastPurchaseBySupplier.get(s.id)?.slice(0, 10) ?? "—"}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.phone ? (
                    <>
                      <a href={`tel:${s.phone}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-stone-200 px-3 text-xs font-black text-stone-800">
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                        {t(lang, "debtsCall")}
                      </a>
                      <a href={`https://wa.me/${s.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-black text-emerald-900">
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                        WhatsApp
                      </a>
                    </>
                  ) : null}
                  <button type="button" onClick={() => onOpenSupplier(s.id)} className="inline-flex min-h-[36px] items-center rounded-xl bg-stone-900 px-3 text-xs font-black text-white">
                    {t(lang, "supplierViewDetail")}
                  </button>
                  {canManage && s.balanceOwedUgx > 0 ? (
                    <button type="button" onClick={() => { setPaySupplier(s); setPayAmount(String(Math.min(s.balanceOwedUgx, 50000))); }} className="inline-flex min-h-[36px] items-center rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-black text-amber-950">
                      {t(lang, "supplierPayButton")}
                    </button>
                  ) : null}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      <ModalSheet open={addOpen} onClose={() => setAddOpen(false)} title={t(lang, "supplierAddTitle")}>
        <form onSubmit={submitAdd} className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t(lang, "supplierNamePh")} required className="w-full rounded-xl border border-stone-200 px-3 py-3 text-sm font-semibold" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t(lang, "supplierPhonePh")} className="w-full rounded-xl border border-stone-200 px-3 py-3 text-sm font-semibold" />
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t(lang, "supplierLocationPh")} className="w-full rounded-xl border border-stone-200 px-3 py-3 text-sm font-semibold" />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t(lang, "supplierNotesPh")} className="w-full rounded-xl border border-stone-200 px-3 py-3 text-sm font-semibold" />
          <button type="submit" className="w-full rounded-xl bg-waka-600 py-3 text-sm font-black text-white">{t(lang, "supplierSave")}</button>
        </form>
      </ModalSheet>

      {paySupplier ? (
        <ModalSheet open onClose={() => setPaySupplier(null)} title={t(lang, "supplierPayTitle")}>
          <form onSubmit={submitPay} className="space-y-3">
            <p className="text-sm font-bold text-stone-800">{paySupplier.name}</p>
            <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="numeric" className="w-full rounded-xl border border-stone-200 px-3 py-3 text-lg font-bold" />
            <button type="submit" className="w-full rounded-xl bg-waka-600 py-3 font-black text-white">{t(lang, "supplierPaySave")}</button>
          </form>
        </ModalSheet>
      ) : null}
    </div>
  );
}
