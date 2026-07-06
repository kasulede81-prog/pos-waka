import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import { ArrowLeft, Search, Star, UtensilsCrossed } from "lucide-react";
import type { Language, Product, SaleLine } from "../types";
import { t } from "../lib/i18n";
import { usePosStore, formatProductPriceLabel } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { formatUgx } from "../lib/formatUgx";
import { computeDraftCheckoutTotals } from "../lib/draftCart";
import { computeRestaurantBillTotals, billDraftFromSale } from "../lib/restaurantBilling";
import { isNamedTabSession, sessionDisplayLabel } from "../lib/hospitality";
import { sessionKitchenSummary } from "../lib/hospitalityOps";
import { BAR_FIRE_STATION_TYPES, KITCHEN_FIRE_STATION_TYPES } from "../lib/kitchenRouting";
import { saveFloorViewState, loadFloorViewState } from "../lib/floorViewState";
import {
  CATEGORY_FILTER_ALL,
  distinctTrimmedCategories,
  productMatchesCategoryFilter,
  productMatchesSellSearch,
  shelfIconFor,
} from "../lib/productCategories";
import { useShallow } from "zustand/react/shallow";
import { hapticTap } from "../lib/nativeFeedback";
import { ModifierPickerSheet } from "../components/hospitality/ModifierPickerSheet";
import { LineNotesSheet } from "../components/hospitality/LineNotesSheet";
import { RestaurantBillSheet } from "../components/hospitality/RestaurantBillSheet";
import { BillPreviewSheet } from "../components/hospitality/BillPreviewSheet";
import { SplitBillSheet } from "../components/hospitality/SplitBillSheet";
import { ManagerPinModal } from "../components/hospitality/ManagerPinModal";
import { TableActionSheet } from "../components/hospitality/TableActionSheet";
import { ShiftSellGateway } from "../components/pos/ShiftSellGateway";
import { RestaurantRunningOrderPanel } from "../components/hospitality/RestaurantRunningOrderPanel";
import { RestaurantActionBar } from "../components/hospitality/RestaurantActionBar";
import { DiscountLineModal } from "../components/pos/DiscountLineModal";
import { CartSaleDiscountModal } from "../components/pos/CartSaleDiscountModal";
import { QuantityEditModal } from "../components/pos/QuantityEditModal";
import { formatDraftLineQty } from "../lib/draftCart";
import { MENU_CATEGORY_PALETTE, categoryColorIndex } from "../lib/menuCategoryColors";

export function TableOrderPage({ lang }: { lang: Language }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const actor = useSessionActor();
  const saveTableBill = usePosStore((s) => s.saveTableBill);
  const fireTableStationTickets = usePosStore((s) => s.fireTableStationTickets);
  const resumeTableSession = usePosStore((s) => s.resumeTableSession);
  const syncCustomerDisplay = usePosStore((s) => s.syncCustomerDisplay);
  const applyDraftLineDiscount = usePosStore((s) => s.applyDraftLineDiscount);
  const setDraftCartDiscount = usePosStore((s) => s.setDraftCartDiscount);
  const setDraftLineQuantity = usePosStore((s) => s.setDraftLineQuantity);
  const addHospitalityDraftLine = usePosStore((s) => s.addHospitalityDraftLine);
  const productNeedsOrderConfig = usePosStore((s) => s.productNeedsOrderConfig);
  const removeDraftLineById = usePosStore((s) => s.removeDraftLineById);
  const setDraftLineNotesById = usePosStore((s) => s.setDraftLineNotesById);
  const setDraftLineCourseById = usePosStore((s) => s.setDraftLineCourseById);
  const applyTableBillSplits = usePosStore((s) => s.applyTableBillSplits);
  const approveTableBillDiscount = usePosStore((s) => s.approveTableBillDiscount);
  const activePendingSaleId = usePosStore((s) => s.activePendingSaleId);
  const preferences = usePosStore((s) => s.preferences);
  const pendingSale = usePosStore((s) =>
    activePendingSaleId ? s.sales.find((x) => x.id === activePendingSaleId) : undefined,
  );
  const clearActiveTableOrder = usePosStore((s) => s.clearActiveTableOrder);
  const transferTableSession = usePosStore((s) => s.transferTableSession);
  const mergeTableSessions = usePosStore((s) => s.mergeTableSessions);
  const setHospitalityManualKitchenFire = usePosStore((s) => s.setHospitalityManualKitchenFire);
  const manualKitchenFire = usePosStore((s) => s.preferences.hospitalityManualKitchenFire === true);
  const kitchenEnabled = usePosStore((s) => s.preferences.hospitalityKitchenEnabled !== false);

  const { products, draftLines, draftCartDiscountUgx, floor, favoriteProductIds } = usePosStore(
    useShallow((s) => ({
      products: s.products,
      draftLines: s.draftLines,
      draftCartDiscountUgx: s.draftCartDiscountUgx,
      floor: s.preferences.hospitalityFloor,
      favoriteProductIds: s.preferences.favoriteProductIds ?? [],
    })),
  );

  const [categoryFilter, setCategoryFilter] = useState<string | null>(CATEGORY_FILTER_ALL);
  const [showFavorites, setShowFavorites] = useState(false);
  const [search, setSearch] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [modifierProduct, setModifierProduct] = useState<Product | null>(null);
  const [lineNotesLine, setLineNotesLine] = useState<SaleLine | null>(null);
  const [discountApproval, setDiscountApproval] = useState<{
    kind: "line" | "bill";
    retry: () => { ok: boolean; errorKey?: string };
  } | null>(null);
  const [tableAction, setTableAction] = useState<"transfer" | "merge" | null>(null);
  const [discountLine, setDiscountLine] = useState<SaleLine | null>(null);
  const [cartSaleDiscountOpen, setCartSaleDiscountOpen] = useState(false);
  const [qtyEditLine, setQtyEditLine] = useState<SaleLine | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [keypadValue, setKeypadValue] = useState("");

  useEffect(() => {
    if (manualKitchenFire) return;
    setHospitalityManualKitchenFire(true);
  }, [manualKitchenFire, setHospitalityManualKitchenFire]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

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

  useEffect(() => {
    syncCustomerDisplay();
  }, [draftLines, draftCartDiscountUgx, syncCustomerDisplay]);

  const categories = useMemo(() => distinctTrimmedCategories(products), [products]);
  const favoriteSet = useMemo(() => new Set(favoriteProductIds), [favoriteProductIds]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (showFavorites && !favoriteSet.has(p.id)) return false;
      if (!productMatchesCategoryFilter(p, categoryFilter ?? CATEGORY_FILTER_ALL)) return false;
      return productMatchesSellSearch(p, search);
    });
  }, [products, categoryFilter, search, showFavorites, favoriteSet]);

  const checkout = useMemo(
    () => computeDraftCheckoutTotals(draftLines, draftCartDiscountUgx),
    [draftLines, draftCartDiscountUgx],
  );

  const billTotals = useMemo(() => {
    const billDraft = billDraftFromSale(pendingSale, preferences);
    return computeRestaurantBillTotals({
      lines: draftLines,
      cartDiscountUgx: draftCartDiscountUgx,
      billDraft,
      prefs: preferences,
    });
  }, [draftLines, draftCartDiscountUgx, pendingSale, preferences]);

  const kitchenSummary = useMemo(
    () => (floor && sessionId ? sessionKitchenSummary(floor, sessionId) : { queued: 0, preparing: 0, ready: 0 }),
    [floor, sessionId],
  );

  const showDiscountError = useCallback(
    (errorKey?: string) => {
      setToast(t(lang, errorKey ?? "saleError"));
      window.setTimeout(() => setToast(null), 2200);
    },
    [lang],
  );

  const addProduct = useCallback(
    (product: Product) => {
      hapticTap();
      if (productNeedsOrderConfig(product)) {
        setModifierProduct(product);
        return;
      }
      const res = addHospitalityDraftLine({ product, quantity: 1 });
      if (!res.ok) {
        showDiscountError(res.errorKey);
        return;
      }
      saveTableBill();
    },
    [productNeedsOrderConfig, addHospitalityDraftLine, saveTableBill, showDiscountError],
  );

  const returnToFloor = useCallback(() => {
    const saved = loadFloorViewState();
    saveFloorViewState(saved ?? { areaId: area?.id ?? null, scrollTop: 0, zoom: 1 });
    navigate("/floor");
  }, [navigate, area?.id]);

  const handleSaveAndReturn = useCallback(() => {
    setActionBusy(true);
    saveTableBill();
    setActionBusy(false);
    returnToFloor();
  }, [saveTableBill, returnToFloor]);

  const handleSendStation = useCallback(
    (stationTypes: import("../types").KitchenStationType[]) => {
      setActionBusy(true);
      saveTableBill();
      const res = fireTableStationTickets(stationTypes);
      setActionBusy(false);
      if (!res.ok) {
        setToast(t(lang, res.errorKey ?? "saleError"));
        window.setTimeout(() => setToast(null), 2200);
        return;
      }
      if ((res.ticketsFired ?? 0) === 0) {
        setToast(t(lang, "restaurantNothingToSend"));
        window.setTimeout(() => setToast(null), 2000);
        return;
      }
      returnToFloor();
    },
    [saveTableBill, fireTableStationTickets, lang, returnToFloor],
  );

  if (!session || (!isNamedTab && !table)) {
    return <Navigate to="/floor" replace />;
  }

  const canSettle = hasPermission(actor.role, "hospitality.settle");
  const canTransfer = hasPermission(actor.role, "hospitality.transfer") && !isNamedTab;
  const canSendKitchen = hasPermission(actor.role, "hospitality.order") && kitchenEnabled;
  const canSendBar = hasPermission(actor.role, "hospitality.order");
  const orderTitle = isNamedTab
    ? sessionDisplayLabel(session, floor!)
    : `${table!.label}${area ? ` · ${area.name}` : ""}`;

  const tryDiscount = useCallback(
    (action: () => { ok: boolean; errorKey?: string }, kind: "line" | "bill") => {
      const r = action();
      if (!r.ok && r.errorKey === "discountManagerApprovalRequired") {
        setDiscountApproval({ kind, retry: () => action() });
        return false;
      }
      if (!r.ok) {
        showDiscountError(r.errorKey);
        return false;
      }
      return true;
    },
    [showDiscountError],
  );

  const handleBillFinalized = useCallback(() => {
    setSettleOpen(false);
    clearActiveTableOrder();
    returnToFloor();
  }, [clearActiveTableOrder, returnToFloor]);

  return (
    <ShiftSellGateway lang={lang}>
      <div className="flex min-h-0 flex-1 flex-col bg-stone-200">
        <header className="flex shrink-0 items-center gap-2 border-b border-stone-400 bg-stone-100 px-2 py-2 sm:px-3">
          <button
            type="button"
            onClick={handleSaveAndReturn}
            className="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded bg-rose-600 text-white shadow-sm"
            aria-label={t(lang, "restaurantBackFloor")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <h1 className="truncate text-lg font-black text-stone-950">{orderTitle}</h1>
            <p className="text-xs font-bold text-stone-600">
              {session.guestCount} {t(lang, "tableOrderGuests")}
              {session.waiterLabel ? ` · ${session.waiterLabel}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSaveAndReturn}
            className="shrink-0 rounded border border-rose-400 bg-rose-50 px-3 py-2 text-xs font-black uppercase text-rose-800"
          >
            {t(lang, "restaurantCloseTable")}
          </button>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {!reviewMode ? (
            <nav className="flex w-24 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-stone-300 bg-stone-100 p-1 sm:w-28">
              <button
                type="button"
                onClick={() => {
                  setShowFavorites((v) => !v);
                  setCategoryFilter(CATEGORY_FILTER_ALL);
                }}
                className={clsx(
                  "rounded px-2 py-3 text-left text-[10px] font-black leading-tight sm:text-xs",
                  showFavorites ? MENU_CATEGORY_PALETTE[5].active + " text-white" : MENU_CATEGORY_PALETTE[5].bg + " " + MENU_CATEGORY_PALETTE[5].text,
                )}
              >
                <Star className="mb-1 h-3.5 w-3.5" />
                {t(lang, "restaurantFavorites")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowFavorites(false);
                  setCategoryFilter(CATEGORY_FILTER_ALL);
                }}
                className={clsx(
                  "rounded px-2 py-3 text-left text-[10px] font-black sm:text-xs",
                  !showFavorites && categoryFilter === CATEGORY_FILTER_ALL
                    ? "bg-stone-700 text-white"
                    : "bg-white text-stone-800",
                )}
              >
                {t(lang, "posCategoryAll")}
              </button>
              {categories.map((cat, i) => {
                const pal = MENU_CATEGORY_PALETTE[categoryColorIndex(cat, i)];
                const active = !showFavorites && categoryFilter === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setShowFavorites(false);
                      setCategoryFilter(cat);
                    }}
                    className={clsx(
                      "rounded px-2 py-3 text-left text-[10px] font-black leading-tight sm:text-xs",
                      active ? pal.active + " text-white" : pal.bg + " " + pal.text,
                    )}
                  >
                    {shelfIconFor(cat)} {cat}
                  </button>
                );
              })}
            </nav>
          ) : null}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
            {!reviewMode ? (
              <>
                <div className="shrink-0 border-b border-stone-200 p-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t(lang, "restaurantSearchMenu")}
                      className="w-full rounded border border-stone-300 py-2 pl-9 pr-3 text-sm"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {filteredProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => addProduct(product)}
                        className="flex flex-col overflow-hidden rounded border border-stone-300 bg-white text-left shadow-sm active:scale-[0.98]"
                      >
                        <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200">
                          <UtensilsCrossed className="h-8 w-8 text-stone-400" />
                        </div>
                        <div className="border-t border-stone-200 p-2">
                          <p className="line-clamp-2 text-xs font-black leading-snug text-stone-900">{product.name}</p>
                          <p className="mt-1 text-sm font-black text-sky-800">{formatProductPriceLabel(product)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid grid-cols-[2rem_3rem_1fr_auto] gap-x-2 border-b border-stone-300 bg-stone-50 px-3 py-2 text-[10px] font-black uppercase text-stone-500">
                  <span>Q</span>
                  <span />
                  <span>{t(lang, "restaurantBillItems")}</span>
                  <span className="text-right">{t(lang, "total")}</span>
                </div>
                {draftLines.map((line) => {
                  const product = productById.get(line.productId);
                  const qtyLabel = product ? formatDraftLineQty(product, line) : String(line.quantity);
                  return (
                    <div
                      key={line.id ?? line.productId}
                      className="grid grid-cols-[2rem_3rem_1fr_auto] items-center gap-x-2 border-b border-stone-200 px-3 py-3"
                    >
                      <span className="text-lg font-black">{qtyLabel}</span>
                      <span className="flex h-10 w-10 items-center justify-center rounded bg-stone-200">
                        <UtensilsCrossed className="h-5 w-5 text-stone-500" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-black text-stone-900">{line.name}</p>
                        {line.notes ? <p className="text-sm font-bold text-rose-600">{line.notes}</p> : null}
                        {line.selectedModifiers?.length ? (
                          <p className="text-xs text-stone-500">
                            {line.selectedModifiers.map((m) => m.optionLabel).join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <span className="font-black tabular-nums">{formatUgx(line.lineTotalUgx)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </main>

          <div className="hidden w-56 shrink-0 lg:flex xl:w-64">
            <RestaurantRunningOrderPanel
              lang={lang}
              lines={draftLines}
              productById={productById}
              totals={checkout}
              serviceChargeUgx={billTotals.serviceChargeUgx}
              guestCount={session.guestCount}
              kitchenSummary={kitchenSummary}
              keypadValue={keypadValue}
              onKeypadChange={setKeypadValue}
              onLineTap={(line) => setQtyEditLine(line)}
              onRemove={(line) => {
                removeDraftLineById(line.id ?? line.productId);
                saveTableBill();
              }}
              className="h-full w-full"
            />
          </div>
        </div>

        <div className="shrink-0 border-t border-stone-300 lg:hidden">
          <RestaurantRunningOrderPanel
            lang={lang}
            lines={draftLines}
            productById={productById}
            totals={checkout}
            serviceChargeUgx={billTotals.serviceChargeUgx}
            guestCount={session.guestCount}
            compact
            keypadValue={keypadValue}
            onKeypadChange={setKeypadValue}
            onLineTap={(line) => setQtyEditLine(line)}
            onRemove={(line) => {
              removeDraftLineById(line.id ?? line.productId);
              saveTableBill();
            }}
            className="max-h-48"
          />
        </div>

        <RestaurantActionBar
          lang={lang}
          canSettle={canSettle}
          canSendKitchen={canSendKitchen}
          canSendBar={canSendBar}
          hasLines={draftLines.length > 0}
          reviewMode={reviewMode}
          busy={actionBusy}
          onToggleReview={() => setReviewMode((v) => !v)}
          onSendKitchen={() => handleSendStation(KITCHEN_FIRE_STATION_TYPES)}
          onSendBar={() => handleSendStation(BAR_FIRE_STATION_TYPES)}
          onSplit={() => setSplitOpen(true)}
          onTransfer={canTransfer ? () => setTableAction("transfer") : undefined}
          onRequestBill={() => {
            saveTableBill();
            setPreviewOpen(true);
          }}
          onSettle={() => {
            saveTableBill();
            setSettleOpen(true);
          }}
          onBackToFloor={handleSaveAndReturn}
        />

        <RestaurantBillSheet
          lang={lang}
          open={settleOpen}
          busy={actionBusy}
          session={session}
          tableLabel={orderTitle}
          areaName={area?.name}
          lines={draftLines}
          cartDiscountUgx={draftCartDiscountUgx}
          onClose={() => setSettleOpen(false)}
          onSplit={() => {
            setSplitOpen(true);
          }}
          onPreview={() => setPreviewOpen(true)}
          onPartialDone={() => {
            setToast(t(lang, "restaurantBillPartialRecorded"));
            window.setTimeout(() => setToast(null), 2500);
          }}
          onFinalized={handleBillFinalized}
        />
        <BillPreviewSheet
          lang={lang}
          open={previewOpen}
          session={session}
          tableLabel={orderTitle}
          areaName={area?.name}
          lines={draftLines}
          cartDiscountUgx={draftCartDiscountUgx}
          pendingSale={pendingSale}
          preferences={preferences}
          onClose={() => setPreviewOpen(false)}
        />
        <SplitBillSheet
          lang={lang}
          open={splitOpen}
          totalUgx={billTotals.grandTotalUgx}
          lines={draftLines}
          guestCount={session.guestCount}
          onClose={() => setSplitOpen(false)}
          onApply={(mode, splits) => {
            applyTableBillSplits({ mode, splits });
            setSplitOpen(false);
          }}
        />
        <ManagerPinModal
          lang={lang}
          open={discountApproval !== null}
          title={t(lang, "discountApprovalTitle")}
          onClose={() => setDiscountApproval(null)}
          onConfirm={({ reason, managerPin }) => {
            if (!discountApproval) return;
            const approved = approveTableBillDiscount({
              kind: discountApproval.kind,
              reason,
              managerPin,
            });
            if (!approved.ok) {
              showDiscountError(approved.errorKey);
              return;
            }
            if (tryDiscount(discountApproval.retry, discountApproval.kind)) {
              saveTableBill();
            }
            setDiscountApproval(null);
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

        {modifierProduct ? (
          <ModifierPickerSheet
            lang={lang}
            open
            product={modifierProduct}
            products={products}
            onClose={() => setModifierProduct(null)}
            onConfirm={(input) => {
              const res = addHospitalityDraftLine({
                product: modifierProduct,
                variantId: input.variantId,
                modifiers: input.modifiers,
                comboSelections: input.comboSelections,
                notes: input.notes,
              });
              setModifierProduct(null);
              if (!res.ok) {
                showDiscountError(res.errorKey);
                return;
              }
              saveTableBill();
            }}
          />
        ) : null}

        {lineNotesLine ? (
          <LineNotesSheet
            lang={lang}
            open
            lineName={lineNotesLine.name}
            initialNotes={lineNotesLine.notes}
            initialCourse={lineNotesLine.course}
            onClose={() => setLineNotesLine(null)}
            onSave={({ notes, course }) => {
              const lineId = lineNotesLine.id ?? lineNotesLine.productId;
              setDraftLineNotesById(lineId, notes);
              setDraftLineCourseById(lineId, course);
              saveTableBill();
              setLineNotesLine(null);
            }}
          />
        ) : null}

        {toast ? (
          <div className="pointer-events-none fixed bottom-24 left-1/2 z-[100] max-w-sm -translate-x-1/2 rounded-2xl bg-rose-950 px-5 py-4 text-center text-base font-semibold text-white shadow-xl">
            {toast}
          </div>
        ) : null}

        <DiscountLineModal
          lang={lang}
          open={discountLine !== null}
          line={discountLine}
          onClose={() => setDiscountLine(null)}
          onApply={(newSellingPriceUgx) => {
            if (!discountLine) return;
            const ok = tryDiscount(
              () => applyDraftLineDiscount(discountLine.productId, "final", newSellingPriceUgx),
              "line",
            );
            if (!ok) return;
            saveTableBill();
            setDiscountLine(null);
          }}
        />

        <CartSaleDiscountModal
          lang={lang}
          open={cartSaleDiscountOpen}
          lineSubtotalUgx={checkout.lineSubtotalUgx}
          currentDiscountUgx={checkout.cartDiscountUgx}
          onClose={() => setCartSaleDiscountOpen(false)}
          onApply={(discountUgx) => {
            const ok = tryDiscount(() => setDraftCartDiscount(discountUgx), "bill");
            if (!ok) return;
            saveTableBill();
            setCartSaleDiscountOpen(false);
          }}
        />

        <QuantityEditModal
          lang={lang}
          open={qtyEditLine !== null}
          productName={qtyEditLine?.name ?? ""}
          qtyLabel={
            qtyEditLine && productById.get(qtyEditLine.productId)
              ? formatDraftLineQty(productById.get(qtyEditLine.productId)!, qtyEditLine)
              : String(qtyEditLine?.quantity ?? "")
          }
          initialQuantity={qtyEditLine?.quantity ?? 0}
          onClose={() => setQtyEditLine(null)}
          onConfirm={(qty) => {
            if (!qtyEditLine) return;
            const r = setDraftLineQuantity(qtyEditLine.productId, qty);
            if (r.ok) saveTableBill();
            setQtyEditLine(null);
          }}
        />
      </div>
    </ShiftSellGateway>
  );
}
