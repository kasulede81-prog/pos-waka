import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import type { Language, Product } from "../types";
import { t } from "../lib/i18n";
import { usePosStore, formatProductPriceLabel } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { computeDraftCheckoutTotals } from "../lib/draftCart";
import { isNamedTabSession, sessionDisplayLabel } from "../lib/hospitality";
import { formatUgx } from "../lib/formatUgx";
import {
  CATEGORY_FILTER_ALL,
  distinctTrimmedCategories,
  productMatchesCategoryFilter,
  productMatchesSellSearch,
  shelfIconFor,
} from "../lib/productCategories";
import { useShallow } from "zustand/react/shallow";
import { hapticTap } from "../lib/nativeFeedback";
import { TableSettleSheet } from "../components/hospitality/TableSettleSheet";
import { SplitBillSheet } from "../components/hospitality/SplitBillSheet";
import { TableActionSheet } from "../components/hospitality/TableActionSheet";
import type { BillSplitLine } from "../types";

export function TableOrderPage({ lang }: { lang: Language }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const actor = useSessionActor();
  const saveTableBill = usePosStore((s) => s.saveTableBill);
  const fireTableKitchenTickets = usePosStore((s) => s.fireTableKitchenTickets);
  const manualKitchenFire = usePosStore((s) => s.preferences.hospitalityManualKitchenFire === true);
  const requestTableBill = usePosStore((s) => s.requestTableBill);
  const resumeTableSession = usePosStore((s) => s.resumeTableSession);
  const addDraftLineFromInput = usePosStore((s) => s.addDraftLineFromInput);
  const setDraftInput = usePosStore((s) => s.setDraftInput);
  const finalizeDraftSale = usePosStore((s) => s.finalizeDraftSale);
  const clearActiveTableOrder = usePosStore((s) => s.clearActiveTableOrder);
  const transferTableSession = usePosStore((s) => s.transferTableSession);
  const mergeTableSessions = usePosStore((s) => s.mergeTableSessions);

  const { products, draftLines, draftCartDiscountUgx, floor } = usePosStore(
    useShallow((s) => ({
      products: s.products,
      draftLines: s.draftLines,
      draftCartDiscountUgx: s.draftCartDiscountUgx,
      floor: s.preferences.hospitalityFloor,
    })),
  );

  const [categoryFilter, setCategoryFilter] = useState<string | null>(CATEGORY_FILTER_ALL);
  const [search, setSearch] = useState("");
  const [settling, setSettling] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitBreakdown, setSplitBreakdown] = useState<BillSplitLine[] | null>(null);
  const [tableAction, setTableAction] = useState<"transfer" | "merge" | null>(null);

  const session = floor?.sessions.find((s) => s.id === sessionId);
  const isNamedTab = session ? isNamedTabSession(session) : false;
  const table = session && !isNamedTab ? floor?.tables.find((tbl) => tbl.id === session.tableId) : undefined;
  const area = table ? floor?.areas.find((a) => a.id === table.areaId) : undefined;

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await resumeTableSession(sessionId);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, resumeTableSession]);

  const categories = useMemo(() => distinctTrimmedCategories(products), [products]);
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (!productMatchesCategoryFilter(p, categoryFilter ?? CATEGORY_FILTER_ALL)) return false;
      return productMatchesSellSearch(p, search);
    });
  }, [products, categoryFilter, search]);

  const checkout = useMemo(
    () => computeDraftCheckoutTotals(draftLines, draftCartDiscountUgx),
    [draftLines, draftCartDiscountUgx],
  );

  const addProduct = useCallback(
    (product: Product) => {
      hapticTap();
      setDraftInput({ product, inputMode: "quantity", value: 1 });
      const built = addDraftLineFromInput();
      if (built.ok) saveTableBill();
    },
    [setDraftInput, addDraftLineFromInput, saveTableBill],
  );

  if (!session || (!isNamedTab && !table)) {
    return <Navigate to="/floor" replace />;
  }

  const canSettle = hasPermission(actor.role, "hospitality.settle");
  const canTransfer = hasPermission(actor.role, "hospitality.transfer") && !isNamedTab;
  const orderTitle = isNamedTab
    ? sessionDisplayLabel(session, floor!)
    : `${table!.label}${area ? ` · ${area.name}` : ""}`;

  const handleSettle = (input: {
    paymentMethod: "cash" | "atm" | "mobile_money" | "mixed";
    amountPaidUgx: number;
    changeGivenUgx: number;
  }) => {
    if (!canSettle || settling || checkout.payableUgx <= 0) return;
    setSettling(true);
    saveTableBill();
    const res = finalizeDraftSale({
      debtUgx: 0,
      paymentMethod: input.paymentMethod,
      amountPaidUgx: input.amountPaidUgx,
      changeGivenUgx: input.changeGivenUgx,
      splitBreakdown,
    });
    setSettling(false);
    if (res.ok) {
      setSettleOpen(false);
      clearActiveTableOrder();
      navigate("/floor");
    }
  };

  return (
    <div className="space-y-4 pb-36">
      <div className="flex items-center gap-3">
        <Link to="/floor" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-black text-stone-950">{orderTitle}</h1>
          <p className="text-sm font-medium text-stone-500">
            {session.guestCount} {t(lang, "tableOrderGuests")}
            {session.waiterLabel ? ` · ${session.waiterLabel}` : ""}
            {isNamedTab ? ` · ${t(lang, "floorNamedTabsTitle")}` : ""}
          </p>
        </div>
      </div>

      {(canTransfer || canSettle) ? (
        <div className="flex flex-wrap gap-2">
          {canTransfer ? (
            <>
              <button
                type="button"
                onClick={() => setTableAction("transfer")}
                className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-700"
              >
                {t(lang, "tableTransferBtn")}
              </button>
              <button
                type="button"
                onClick={() => setTableAction("merge")}
                className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-700"
              >
                {t(lang, "tableMergeBtn")}
              </button>
            </>
          ) : null}
          {canSettle ? (
            <button
              type="button"
              onClick={() => setSplitOpen(true)}
              className="min-h-10 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-700"
            >
              {t(lang, "splitBillBtn")}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setCategoryFilter(CATEGORY_FILTER_ALL)}
          className={clsx(
            "shrink-0 rounded-full px-3 py-2 text-sm font-bold",
            categoryFilter === CATEGORY_FILTER_ALL ? "bg-waka-600 text-white" : "bg-slate-100",
          )}
        >
          {t(lang, "posCategoryAll")}
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategoryFilter(cat)}
            className={clsx(
              "shrink-0 rounded-full px-3 py-2 text-sm font-bold",
              categoryFilter === cat ? "bg-waka-600 text-white" : "bg-slate-100",
            )}
          >
            {shelfIconFor(cat)} {cat}
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t(lang, "posSellSearchPlaceholder")}
        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {filteredProducts.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => addProduct(product)}
            className="flex min-h-[88px] flex-col items-start justify-between rounded-2xl border border-slate-200 bg-white p-3 text-left active:bg-waka-50"
          >
            <span className="line-clamp-2 text-sm font-black text-stone-950">{product.name}</span>
            <span className="text-sm font-bold text-waka-700">{formatProductPriceLabel(product)}</span>
          </button>
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-slate-200 bg-white/95 p-4 backdrop-blur sm:bottom-0 sm:pb-4">
        <div className="mx-auto max-w-3xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">{t(lang, "tableRunningBill")}</span>
            <span className="text-xl font-black text-stone-950">{formatUgx(checkout.payableUgx)}</span>
          </div>
          {draftLines.length > 0 ? (
            <ul className="max-h-28 space-y-1 overflow-y-auto text-sm">
              {draftLines.map((line) => (
                <li key={line.productId} className="flex justify-between gap-2 font-medium text-slate-700">
                  <span>
                    {line.quantity}× {line.name}
                  </span>
                  <span>{formatUgx(line.lineTotalUgx)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {manualKitchenFire ? (
              <button
                type="button"
                onClick={() => fireTableKitchenTickets()}
                className="col-span-2 min-h-12 rounded-xl border border-waka-300 bg-waka-50 text-sm font-black text-waka-900"
              >
                {t(lang, "tableSendKitchen")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                saveTableBill();
                requestTableBill(session.id);
                navigate("/floor");
              }}
              className="min-h-12 rounded-xl border border-amber-300 bg-amber-50 text-sm font-black text-amber-950"
            >
              {t(lang, "tableRequestBill")}
            </button>
            <button
              type="button"
              disabled={!canSettle || checkout.payableUgx <= 0}
              onClick={() => setSettleOpen(true)}
              className="min-h-12 rounded-xl bg-waka-600 text-sm font-black text-white disabled:opacity-50"
            >
              {t(lang, "tableSettleBill")}
            </button>
          </div>
        </div>
      </div>

      <TableSettleSheet
        lang={lang}
        open={settleOpen}
        totalUgx={checkout.payableUgx}
        busy={settling}
        splitBreakdown={splitBreakdown}
        onClose={() => setSettleOpen(false)}
        onConfirm={handleSettle}
      />
      <SplitBillSheet
        lang={lang}
        open={splitOpen}
        totalUgx={checkout.payableUgx}
        onClose={() => setSplitOpen(false)}
        onApply={(splits) => {
          setSplitBreakdown(splits);
          setSplitOpen(false);
          setSettleOpen(true);
        }}
      />
      {floor && tableAction && sessionId && !isNamedTab ? (
        <TableActionSheet
          lang={lang}
          open
          mode={tableAction}
          floor={floor}
          fromSessionId={sessionId}
          onClose={() => setTableAction(null)}
          onSelectTable={(tableId) => {
            if (tableAction === "transfer") {
              transferTableSession(sessionId, tableId);
            } else {
              const targetSession = floor.sessions.find(
                (s) => s.tableId === tableId && (s.status === "open" || s.status === "payment_pending"),
              );
              if (targetSession) mergeTableSessions(sessionId, targetSession.id);
            }
            setTableAction(null);
          }}
        />
      ) : null}
    </div>
  );
}
