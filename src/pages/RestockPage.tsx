import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Plus } from "lucide-react";
import clsx from "clsx";
import { PageHeader } from "../components/layout/PageHeader";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { purchaseLineCostTotalUgx } from "../lib/sellingEngine";
import { WALK_IN_SUPPLIER_ID } from "../lib/walkInSupplier";
import { AppModalOverlay } from "../components/layout/AppModalOverlay";
import { RestockLineCard, type RestockLineRow } from "../components/stock/RestockLineCard";

type BuySource = "town" | "supplier";

export function RestockPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  if (!hasPermission(actor.role, "purchases.record")) {
    return <Navigate to="/" replace />;
  }

  const suppliers = usePosStore((s) => s.suppliers);
  const products = usePosStore((s) => s.products);
  const recordPurchase = usePosStore((s) => s.recordPurchase);

  const [buySource, setBuySource] = useState<BuySource>("town");
  const [supplierId, setSupplierId] = useState("");
  const [townPlace, setTownPlace] = useState("");
  const [lines, setLines] = useState<RestockLineRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [paidStr, setPaidStr] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"ok" | "err">("ok");

  const walkIn = buySource === "town";
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const filteredProducts = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const picked = new Set(lines.map((l) => l.productId));
    let list = products.filter((p) => !picked.has(p.id));
    if (q) list = list.filter((p) => [p.name, p.category, p.baseUnit].filter(Boolean).join(" ").toLowerCase().includes(q));
    return list.slice(0, 80);
  }, [products, pickerQuery, lines]);

  const totals = useMemo(() => {
    let sum = 0;
    for (const row of lines) {
      const p = productById.get(row.productId);
      if (!p) continue;
      const qty = Number(row.qtyBuyingStr) || 0;
      const cost = Math.floor(Number(row.costPerBuyingStr.replace(/\D/g, "")) || 0);
      sum += purchaseLineCostTotalUgx({ qtyBuyingUnits: qty, costPerBuyingUnitUgx: cost });
    }
    return sum;
  }, [lines, productById]);

  const paidAmount = Math.floor(Number(paidStr.replace(/\D/g, "")) || 0);
  const balanceOwed = walkIn ? 0 : Math.max(0, totals - paidAmount);

  useEffect(() => {
    if (walkIn) return;
    if (!supplierId && suppliers.length > 0) setSupplierId(suppliers[0]!.id);
  }, [walkIn, supplierId, suppliers]);

  const addProductLine = (productId: string) => {
    setLines((prev) => [...prev, { key: crypto.randomUUID(), productId, qtyBuyingStr: "1", costPerBuyingStr: "" }]);
    setPickerOpen(false);
    setPickerQuery("");
    setMsg(null);
  };

  const updateLine = (key: string, patch: Partial<Pick<RestockLineRow, "qtyBuyingStr" | "costPerBuyingStr">>) => {
    setLines((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((r) => r.key !== key));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const built = lines
      .map((r) => ({
        productId: r.productId,
        qtyBuyingUnits: Number(r.qtyBuyingStr) || 0,
        costPerBuyingUnitUgx: Math.floor(Number(r.costPerBuyingStr.replace(/\D/g, "")) || 0),
      }))
      .filter((r) => r.productId && r.qtyBuyingUnits > 0 && r.costPerBuyingUnitUgx >= 0);

    if (!built.length) {
      setMsgTone("err");
      setMsg(t(lang, "restockAddLineHint"));
      return;
    }

    if (!walkIn && !supplierId) {
      setMsgTone("err");
      setMsg(t(lang, "restockPickSupplier"));
      return;
    }

    const paid = walkIn ? totals : paidAmount;
    const townLabel = townPlace.trim();
    const supplierName = walkIn
      ? townLabel || t(lang, "restockSourceTown")
      : suppliers.find((s) => s.id === supplierId)?.name;

    const r = recordPurchase({
      supplierId: walkIn ? WALK_IN_SUPPLIER_ID : supplierId,
      supplierName,
      lines: built,
      amountPaidUgx: paid,
      notes: notes.trim(),
    });

    if (!r.ok) {
      setMsgTone("err");
      setMsg(t(lang, "restockSaveError"));
      return;
    }

    setLines([]);
    setPaidStr("");
    setNotes("");
    setTownPlace("");
    setBuySource("town");
    setMsgTone("ok");
    setMsg(t(lang, "restockSavedShort"));
  };

  const inputClass =
    "mt-1 min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-bold text-slate-900 outline-none focus:border-waka-400 focus:ring-2 focus:ring-waka-200";

  return (
    <div className="pb-28">
      <PageHeader lang={lang} title={t(lang, "restockTitle")} subtitle={t(lang, "restockSub")} backLabel={t(lang, "officeBackToHub")} />

      {msg ? (
        <p
          className={clsx(
            "mb-4 rounded-2xl px-4 py-3 text-sm font-bold",
            msgTone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900",
          )}
        >
          {msg}
        </p>
      ) : null}

      <form onSubmit={submit} className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">{t(lang, "restockWhereBought")}</h2>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setBuySource("town")}
              className={clsx(
                "min-h-[48px] rounded-2xl border-2 px-3 text-sm font-black transition",
                walkIn ? "border-waka-500 bg-waka-600 text-white" : "border-slate-200 bg-white text-slate-800",
              )}
            >
              {t(lang, "restockSourceTown")}
            </button>
            <button
              type="button"
              onClick={() => setBuySource("supplier")}
              className={clsx(
                "min-h-[48px] rounded-2xl border-2 px-3 text-sm font-black transition",
                !walkIn ? "border-waka-500 bg-waka-600 text-white" : "border-slate-200 bg-white text-slate-800",
              )}
            >
              {t(lang, "restockSourceSupplier")}
            </button>
          </div>

          {walkIn ? (
            <input
              value={townPlace}
              onChange={(e) => setTownPlace(e.target.value)}
              placeholder={t(lang, "restockTownPlacePh")}
              className={inputClass}
            />
          ) : (
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className={inputClass}
            >
              {suppliers.length === 0 ? (
                <option value="">{t(lang, "restockNoSuppliersShort")}</option>
              ) : (
                suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          )}

          {!walkIn && suppliers.length === 0 ? (
            <p className="text-sm font-semibold text-slate-600">
              <Link to="/suppliers" className="font-black text-waka-800 underline">
                {t(lang, "restockAddSupplierLink")}
              </Link>
            </p>
          ) : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">{t(lang, "restockProductsTitle")}</h2>

          {lines.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm font-semibold text-slate-500">
              {t(lang, "restockEmptyProducts")}
            </p>
          ) : (
            <ul className="space-y-3">
              {lines.map((row) => {
                const p = productById.get(row.productId);
                if (!p) return null;
                return (
                  <RestockLineCard
                    key={row.key}
                    lang={lang}
                    product={p}
                    row={row}
                    onChange={(patch) => updateLine(row.key, patch)}
                    onRemove={() => removeLine(row.key)}
                  />
                );
              })}
            </ul>
          )}

          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-waka-300 bg-waka-50/50 text-base font-black text-waka-900 active:bg-waka-100"
          >
            <Plus className="h-5 w-5" />
            {lines.length === 0 ? t(lang, "restockAddProduct") : t(lang, "restockAddAnother")}
          </button>
        </section>

        {lines.length > 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold text-slate-600">{t(lang, "restockTotalBuy")}</span>
              <span className="text-xl font-black text-slate-900">UGX {totals.toLocaleString()}</span>
            </div>

            {!walkIn ? (
              <>
                <label className="mt-4 block">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "restockPaidToday")}</span>
                  <input
                    value={paidStr}
                    onChange={(e) => setPaidStr(e.target.value.replace(/\D/g, "").slice(0, 12))}
                    inputMode="numeric"
                    placeholder={String(totals)}
                    className={inputClass}
                  />
                </label>
                {balanceOwed > 0 ? (
                  <p className="mt-2 text-sm font-bold text-amber-800">
                    {tTemplate(lang, "restockStillOwe", { amount: balanceOwed.toLocaleString() })}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
        ) : null}

        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "restockNoteOptional")}</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t(lang, "restockNotePh")}
            className={inputClass}
          />
        </label>

        <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] left-0 right-0 z-30 border-t border-slate-200/90 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <button
            type="submit"
            disabled={!lines.length}
            className="w-full min-h-[56px] rounded-2xl bg-waka-600 text-lg font-black text-white shadow-lg disabled:opacity-40 active:bg-waka-700"
          >
            {t(lang, "restockFinish")}
          </button>
        </div>
      </form>

      {pickerOpen ? (
        <AppModalOverlay
          className="z-[56] flex items-end justify-center bg-black/50 sm:items-center"
          role="dialog"
          aria-modal
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="flex max-h-[min(88dvh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-100 px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-black text-slate-900">{t(lang, "restockPickProduct")}</p>
                <button type="button" className="text-sm font-bold text-slate-600" onClick={() => setPickerOpen(false)}>
                  {t(lang, "cancel")}
                </button>
              </div>
              <input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder={t(lang, "restockSearchProducts")}
                className="mt-3 min-h-[44px] w-full rounded-xl border-2 border-slate-200 px-3 text-base font-semibold"
                autoFocus
              />
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              {filteredProducts.length === 0 ? (
                <li className="px-2 py-8 text-center text-sm font-semibold text-slate-500">{t(lang, "restockNoProductsMatch")}</li>
              ) : (
                filteredProducts.map((p) => (
                  <li key={p.id} className="mb-2">
                    <button
                      type="button"
                      onClick={() => addProductLine(p.id)}
                      className="w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3.5 text-left active:bg-waka-50"
                    >
                      <span className="text-base font-black text-slate-900">{p.name}</span>
                      {p.category ? (
                        <span className="mt-0.5 block text-xs font-semibold text-slate-500">{p.category}</span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </AppModalOverlay>
      ) : null}
    </div>
  );
}
