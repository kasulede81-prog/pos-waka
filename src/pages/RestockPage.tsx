import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { purchaseLineCostTotalUgx } from "../lib/sellingEngine";
import { WALK_IN_SUPPLIER_ID } from "../lib/walkInSupplier";
import { dateKeyKampala } from "../lib/datesUg";
import { RestockLineCard, type RestockLineRow } from "../components/stock/RestockLineCard";
import { RestockProductPicker } from "../components/stock/RestockProductPicker";
import { ReceiveOperationShell } from "../components/inventory/receive/ReceiveOperationShell";
import { SupplierSelector } from "../components/inventory/receive/SupplierSelector";
import { ReceiveHeader } from "../components/inventory/receive/ReceiveHeader";
import { ReceiveTotalsPanel } from "../components/inventory/receive/ReceiveTotalsPanel";
import { ReceiveSummaryPanel } from "../components/inventory/receive/ReceiveSummaryPanel";
import { ReceiveFooter } from "../components/inventory/receive/ReceiveFooter";
import { ReceiveStatusStrip } from "../components/inventory/receive/ReceiveStatusStrip";
import { WIZARD_INPUT_TEXT } from "../components/inventory/receive/receiveTokens";
import { RECEIVE_FIELD_LABEL } from "../components/inventory/receive/receiveTokens";

type BuySource = "town" | "supplier";

export function RestockPage({
  lang,
  embedded,
  onSaved,
}: {
  lang: Language;
  embedded?: boolean;
  onSaved?: () => void;
}) {
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
    if (q)
      list = list.filter((p) =>
        [p.name, p.category, p.baseUnit, p.buyingUnit].filter(Boolean).join(" ").toLowerCase().includes(q),
      );
    return list.slice(0, 80);
  }, [products, pickerQuery, lines]);

  const totals = useMemo(() => {
    let sum = 0;
    let units = 0;
    for (const row of lines) {
      const p = productById.get(row.productId);
      if (!p) continue;
      const qty = Number(row.qtyBuyingStr) || 0;
      const cost = Math.floor(Number(row.costPerBuyingStr.replace(/\D/g, "")) || 0);
      sum += purchaseLineCostTotalUgx({ qtyBuyingUnits: qty, costPerBuyingUnitUgx: cost });
      units += qty;
    }
    return { sum, units, count: lines.length };
  }, [lines, productById]);

  const paidAmount = Math.floor(Number(paidStr.replace(/\D/g, "")) || 0);
  const balanceOwed = walkIn ? 0 : Math.max(0, totals.sum - paidAmount);

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

  const supplierName = walkIn
    ? townPlace.trim() || t(lang, "restockSourceTown")
    : suppliers.find((s) => s.id === supplierId)?.name;

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

    const paid = walkIn ? totals.sum : paidAmount;

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
    onSaved?.();
  };

  return (
    <div className={embedded ? "pb-8" : "pb-28"}>
      {!embedded ? (
        <PageHeader lang={lang} title={t(lang, "restockTitle")} subtitle={t(lang, "restockSub")} backLabel={t(lang, "officeBackToHub")} />
      ) : null}

      <ReceiveOperationShell
        lang={lang}
        variant="page"
        open
        title={embedded ? t(lang, "ipNewPurchaseTitle") : ""}
        subtitle={embedded ? t(lang, "restockSub") : undefined}
        error={msgTone === "err" ? msg : null}
        success={msgTone === "ok" ? msg : null}
        onSubmit={submit}
        statusStrip={<ReceiveStatusStrip lang={lang} />}
        pageClassName="mt-2"
        footer={
          <ReceiveFooter
            lang={lang}
            layout="single"
            primaryLabelKey="restockFinish"
            primaryDisabled={!lines.length}
            fixed={!embedded}
          />
        }
      >
        <SupplierSelector
          lang={lang}
          mode="town-or-supplier"
          suppliers={suppliers}
          supplierId={supplierId}
          onSupplierIdChange={setSupplierId}
          buySource={buySource}
          onBuySourceChange={setBuySource}
          townPlace={townPlace}
          onTownPlaceChange={setTownPlace}
          addSupplierHref="/stock?tab=suppliers"
        />

        <section className="space-y-3">
          <ReceiveHeader title={t(lang, "restockProductsTitle")} />

          {lines.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm font-semibold text-muted-foreground">
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
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 text-base font-black text-primary active:bg-primary/10"
          >
            <Plus className="h-5 w-5" />
            {lines.length === 0 ? t(lang, "restockAddProduct") : t(lang, "restockAddAnother")}
          </button>
        </section>

        {lines.length > 0 ? (
          <>
            <ReceiveTotalsPanel
              lang={lang}
              totalUgx={totals.sum}
              showPartialPayment={!walkIn}
              paidStr={paidStr}
              onPaidChange={setPaidStr}
              balanceOwedUgx={balanceOwed}
            />
            <ReceiveSummaryPanel
              lang={lang}
              invoiceTotalUgx={totals.sum}
              productCount={totals.count}
              unitsReceived={totals.units}
              supplierName={supplierName}
              businessDate={dateKeyKampala(new Date())}
              purchaseReference={notes.trim() || undefined}
            />
          </>
        ) : null}

        <label className="block">
          <span className={RECEIVE_FIELD_LABEL}>{t(lang, "restockNoteOptional")}</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t(lang, "restockNotePh")}
            className={`${WIZARD_INPUT_TEXT} mt-2 text-base`}
          />
        </label>
      </ReceiveOperationShell>

      <RestockProductPicker
        lang={lang}
        open={pickerOpen}
        query={pickerQuery}
        onQueryChange={setPickerQuery}
        products={filteredProducts}
        onPick={addProductLine}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
