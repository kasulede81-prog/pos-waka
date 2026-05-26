import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { buyingUnitsToBaseUnits, purchaseLineCostTotalUgx } from "../lib/sellingEngine";
import { isWalkInSupplierId, WALK_IN_SUPPLIER_ID } from "../lib/walkInSupplier";
import { AppModalOverlay } from "../components/layout/AppModalOverlay";

type LineRow = { key: string; productId: string; qtyBuyingStr: string; costPerBuyingStr: string };

export function RestockPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  if (!hasPermission(actor.role, "purchases.record")) {
    return <Navigate to="/" replace />;
  }

  const suppliers = usePosStore((s) => s.suppliers);
  const products = usePosStore((s) => s.products);
  const recordPurchase = usePosStore((s) => s.recordPurchase);

  const [supplierId, setSupplierId] = useState(WALK_IN_SUPPLIER_ID);
  const [townPlace, setTownPlace] = useState("");
  const [lines, setLines] = useState<LineRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paidStr, setPaidStr] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const walkIn = isWalkInSupplierId(supplierId);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const totals = useMemo(() => {
    let sum = 0;
    for (const row of lines) {
      const p = productById.get(row.productId);
      if (!p) continue;
      const qty = Number(row.qtyBuyingStr) || 0;
      const cost = Math.floor(Number(row.costPerBuyingStr) || 0);
      sum += purchaseLineCostTotalUgx({ qtyBuyingUnits: qty, costPerBuyingUnitUgx: cost });
    }
    return sum;
  }, [lines, productById]);

  const addProductLine = (productId: string) => {
    setLines((prev) => [
      ...prev,
      { key: crypto.randomUUID(), productId, qtyBuyingStr: "1", costPerBuyingStr: "" },
    ]);
    setPickerOpen(false);
    setMsg(null);
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
        costPerBuyingUnitUgx: Math.floor(Number(r.costPerBuyingStr) || 0),
      }))
      .filter((r) => r.productId && r.qtyBuyingUnits > 0 && r.costPerBuyingUnitUgx >= 0);
    if (!built.length) {
      setMsg(t(lang, "restockAddLineHint"));
      return;
    }
    const paid = Math.floor(Number(paidStr) || 0);
    const townLabel = townPlace.trim();
    const supplierName = walkIn
      ? townLabel || t(lang, "restockTownBuy")
      : suppliers.find((s) => s.id === supplierId)?.name;
    const r = recordPurchase({
      supplierId: walkIn ? WALK_IN_SUPPLIER_ID : supplierId,
      supplierName,
      lines: built,
      amountPaidUgx: paid,
      notes,
    });
    if (!r.ok) {
      setMsg(t(lang, "restockSaveError"));
      return;
    }
    setLines([]);
    setPaidStr("");
    setNotes("");
    setTownPlace("");
    setMsg(t(lang, "restockSaved"));
  };

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/stock" className="text-sm font-bold text-waka-700">
          ← {t(lang, "stockTitle")}
        </Link>
        <Link to="/suppliers" className="text-sm font-bold text-slate-600">
          {t(lang, "navSuppliers")}
        </Link>
      </div>
      <h1 className="text-3xl font-black text-slate-900">{t(lang, "restockTitle")}</h1>
      <p className="text-slate-600">{t(lang, "restockSub")}</p>

      {msg ? <p className="rounded-2xl bg-waka-50 px-4 py-3 text-sm font-bold text-waka-900">{msg}</p> : null}

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-bold text-slate-700">{t(lang, "restockSupplier")}</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg font-semibold"
          >
            <option value={WALK_IN_SUPPLIER_ID}>{t(lang, "restockTownBuy")}</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs font-medium leading-relaxed text-slate-600">{t(lang, "restockTownBuyHint")}</p>
        </label>

        {walkIn ? (
          <label className="block text-sm font-bold text-slate-700">
            {t(lang, "restockTownPlace")}
            <input
              value={townPlace}
              onChange={(e) => setTownPlace(e.target.value)}
              placeholder={t(lang, "restockTownPlacePh")}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3 text-lg"
            />
          </label>
        ) : null}

        {suppliers.length === 0 ? (
          <p className="text-sm font-semibold text-slate-600">
            {t(lang, "restockNoSuppliersOptional")}{" "}
            <Link to="/suppliers" className="font-black text-waka-800 underline">
              {t(lang, "navSuppliers")}
            </Link>
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="min-h-[52px] flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white"
          >
            {t(lang, "restockAddProduct")}
          </button>
        </div>

        <ul className="space-y-3">
          {lines.map((row) => {
            const p = productById.get(row.productId);
            if (!p) return null;
            const qty = Number(row.qtyBuyingStr) || 0;
            const cost = Math.floor(Number(row.costPerBuyingStr) || 0);
            const base = buyingUnitsToBaseUnits(p, qty);
            const lineTot = purchaseLineCostTotalUgx({ qtyBuyingUnits: qty, costPerBuyingUnitUgx: cost });
            const pack = p.buyingUnit?.trim() || t(lang, "restockPackFallback");
            return (
              <li key={row.key} className="rounded-3xl border-2 border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-lg font-black text-slate-900">{p.name}</p>
                  <button type="button" className="text-sm font-bold text-rose-700" onClick={() => removeLine(row.key)}>
                    {t(lang, "removeLine")}
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  {tTemplate(lang, "restockPackHint", { pack, base: p.baseUnit })}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-sm font-bold text-slate-700">
                    {t(lang, "restockQtyPack")}
                    <input
                      value={row.qtyBuyingStr}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) => (x.key === row.key ? { ...x, qtyBuyingStr: e.target.value } : x)),
                        )
                      }
                      inputMode="decimal"
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-lg"
                    />
                  </label>
                  <label className="text-sm font-bold text-slate-700">
                    {t(lang, "restockCostPerPack")}
                    <input
                      value={row.costPerBuyingStr}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((x) => (x.key === row.key ? { ...x, costPerBuyingStr: e.target.value } : x)),
                        )
                      }
                      inputMode="numeric"
                      className="mt-1 w-full rounded-xl border-2 px-3 py-2 text-lg"
                    />
                  </label>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  {t(lang, "restockShelfAdds")}: {base.toLocaleString()} {p.baseUnit} · {t(lang, "restockLineTotal")}: UGX{" "}
                  {lineTot.toLocaleString()}
                </p>
              </li>
            );
          })}
        </ul>

        <div className="rounded-3xl border-2 border-waka-100 bg-waka-50/50 p-4">
          <p className="text-sm font-bold text-waka-950">
            {t(lang, "restockInvoiceTotal")}: UGX {totals.toLocaleString()}
          </p>
          <label className="mt-3 block text-sm font-bold text-slate-800">
            {t(lang, "restockPaidNow")}
            <input
              value={paidStr}
              onChange={(e) => setPaidStr(e.target.value)}
              inputMode="numeric"
              placeholder={String(totals)}
              className="mt-1 w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg"
            />
          </label>
          <p className="mt-2 text-xs text-slate-600">
            {walkIn ? t(lang, "restockPaidHintTown") : t(lang, "restockPaidHint")}
          </p>
        </div>

        <label className="block text-sm font-bold text-slate-700">
          {t(lang, "restockNotes")}
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-2xl border-2 border-slate-200 px-4 py-3"
          />
        </label>

        <button
          type="submit"
          disabled={!lines.length}
          className="w-full rounded-2xl bg-waka-600 py-4 text-lg font-black text-white disabled:opacity-50"
        >
          {t(lang, "restockSave")}
        </button>
      </form>

      {pickerOpen ? (
        <AppModalOverlay className="z-[56] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal>
          <div className="max-h-[min(88dvh,900px)] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:rounded-3xl">
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg font-black">{t(lang, "restockPickProduct")}</p>
              <button type="button" className="font-bold text-slate-600" onClick={() => setPickerOpen(false)}>
                {t(lang, "cancel")}
              </button>
            </div>
            <ul className="mt-3 space-y-2">
              {products.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addProductLine(p.id)}
                    className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-left text-base font-bold text-slate-900 active:bg-slate-100"
                  >
                    {p.name}
                    <span className="mt-0.5 block text-xs font-medium text-slate-500">
                      {p.buyingUnit ? `${p.buyingUnit} → ${p.baseUnit}` : p.baseUnit}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </AppModalOverlay>
      ) : null}
    </div>
  );
}
