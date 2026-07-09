import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actorHasEffectivePermission } from "../../../lib/actorAuthorization";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import type { Language, PharmacyPrescriptionType, SaleLine } from "../../../types";
import { t } from "../../../lib/i18n";
import { usePosStore } from "../../../store/usePosStore";
import { isPharmacyMode } from "../../../lib/pharmacy";
import { useSessionActor } from "../../../context/SessionActorContext";

import { useSubscription } from "../../../context/SubscriptionContext";
import {
  activePrescriptionQueue,
  prescriptionHasControlledMedicines,
} from "../../../lib/pharmacyPrescriptions";
import { addLineToPrescription } from "../../../lib/pharmacyPrescriptionOps";
import { PharmacyVerificationSheet } from "../prescription/PharmacyVerificationSheet";
import { PharmacyControlledApprovalModal } from "../prescription/PharmacyControlledApprovalModal";
import { PharmacyControlledDispenseGate } from "../compliance/PharmacyControlledDispenseGate";
import { PharmacyFefoBatchPicker } from "../PharmacyFefoBatchPicker";
import { SellProductBrowsePanel } from "../../pos/SellProductBrowsePanel";
import { PosCheckoutPanel } from "../../pos/PosCheckoutPanel";
import { PosDesktopCompactHeader } from "../../pos/PosDesktopCompactHeader";
import { PosOfflineBanner } from "../../trust/PosOfflineBanner";
import { ShiftSellGateway } from "../../pos/ShiftSellGateway";
import { ShiftCloseModal } from "../../pos/ShiftCloseModal";
import { PosCompactCheckoutSlideover } from "../../pos/PosCompactCheckoutSlideover";
import { PosMinimizedCheckoutFab } from "../../pos/PosMinimizedCheckoutFab";
import { PosScreenPortal } from "../../layout/PosScreenPortal";
import { DiscountLineModal } from "../../pos/DiscountLineModal";
import { CartSaleDiscountModal } from "../../pos/CartSaleDiscountModal";
import { QuantityEditModal } from "../../pos/QuantityEditModal";
import { usePosLayoutMode } from "../../../hooks/usePosLayoutMode";
import { usePosViewportWidth } from "../../../hooks/usePosViewportWidth";
import { usePharmacyDispenseCheckout } from "../../../hooks/usePharmacyDispenseCheckout";
import { summarizeTodaySales } from "../../../lib/todaySalesSummary";
import { pendingSales } from "../../../lib/saleStatus";
import { POS_HOME_ROUTE } from "../../../lib/posNavigation";
import {
  shouldMountCompactCheckoutSlideover,
  shouldMountDesktopCheckoutSidebar,
  shouldMountMobileCheckoutOverlay,
  shouldShowMinimizedCheckoutFab,
} from "../../../lib/posCheckoutMount";
import { posSplitGridTemplateColumns } from "../../../lib/posDesktopSplit";
import { useDisplayScale } from "../../../hooks/useDisplayScale";
import { DISPLAY_SCALE_META } from "../../../lib/displayScale/scaleTokens";
import { PharmacyCustomerContextBar } from "./PharmacyCustomerContextBar";
import { PharmacyPatientContextPanel } from "./PharmacyPatientContextPanel";
import { PharmacyPatientSearchDrawer } from "./PharmacyPatientSearchDrawer";
import { PharmacyNewPatientDrawer } from "./PharmacyNewPatientDrawer";
import { PharmacyPrescriptionQueueDrawer } from "./PharmacyPrescriptionQueueDrawer";
import { PharmacyCheckoutMetaStrip } from "./PharmacyCheckoutMetaStrip";
import { PharmacyRxActionBar } from "./PharmacyRxActionBar";
import type { PharmacyCustomerContextMode } from "./pharmacyDispenseTypes";
import { buildSaleReceiptContext } from "../../../lib/receiptContextHelpers";
import { downloadSaleReceiptPdf, printSaleReceipt, shareSaleReceiptPdf } from "../../../lib/receiptDocuments";
import { DocumentActionsBar } from "../../documents/DocumentActionsBar";
import { formatDraftLineQty, computeDraftCheckoutTotals } from "../../../lib/draftCart";
import { logReceiptPdfExportAudit, logReceiptReprintAudit } from "../../../lib/auditReceiptLog";

type Props = { lang: Language };

export function PharmacyDispenseWorkspace({ lang }: Props) {
  const [searchParams] = useSearchParams();
  const otcMode = searchParams.get("mode") === "otc";
  const patientParam = searchParams.get("patient");

  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const sales = usePosStore((s) => s.sales);
  const prescriptions = usePosStore((s) => s.pharmacyPrescriptions);
  const draftLines = usePosStore((s) => s.draftLines);
  const activePharmacyPrescriptionId = usePosStore((s) => s.activePharmacyPrescriptionId);
  const pharmacyDispenseMode = usePosStore((s) => s.pharmacyDispenseMode);
  const addCustomer = usePosStore((s) => s.addCustomer);
  const createPharmacyPrescription = usePosStore((s) => s.createPharmacyPrescription);
  const updatePharmacyPrescription = usePosStore((s) => s.updatePharmacyPrescription);
  const transitionPharmacyPrescription = usePosStore((s) => s.transitionPharmacyPrescription);
  const verifyPharmacyPrescription = usePosStore((s) => s.verifyPharmacyPrescription);
  const loadPrescriptionToDraft = usePosStore((s) => s.loadPrescriptionToDraft);
  const setPharmacyDispenseMode = usePosStore((s) => s.setPharmacyDispenseMode);
  const createPharmacyRefill = usePosStore((s) => s.createPharmacyRefill);
  const approveControlledDispense = usePosStore((s) => s.approveControlledDispense);
  const addDraftLineFromInput = usePosStore((s) => s.addDraftLineFromInput);
  const setDraftInput = usePosStore((s) => s.setDraftInput);
  const setDraftLineBatchOverride = usePosStore((s) => s.setDraftLineBatchOverride);
  const applyDraftLineDiscount = usePosStore((s) => s.applyDraftLineDiscount);
  const setDraftCartDiscount = usePosStore((s) => s.setDraftCartDiscount);
  const draftCartDiscountUgx = usePosStore((s) => s.draftCartDiscountUgx);
  const closeShiftWithCashCount = usePosStore((s) => s.closeShiftWithCashCount);

  const [contextMode, setContextMode] = useState<PharmacyCustomerContextMode>("walk_in");
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedRxId, setSelectedRxId] = useState<string | null>(null);
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [rxQueueOpen, setRxQueueOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [controlledOpen, setControlledOpen] = useState(false);
  const [batchPickerLine, setBatchPickerLine] = useState<SaleLine | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saleCheckoutMinimized, setSaleCheckoutMinimized] = useState(false);
  const [catalogNumpadOpen, setCatalogNumpadOpen] = useState(false);
  const [discountLine, setDiscountLine] = useState<SaleLine | null>(null);
  const [qtyEditLine, setQtyEditLine] = useState<SaleLine | null>(null);
  const [cartSaleDiscountOpen, setCartSaleDiscountOpen] = useState(false);
  const [shiftCloseOpen, setShiftCloseOpen] = useState(false);

  const catalogRef = useRef<HTMLDivElement>(null);
  const posLayoutMode = usePosLayoutMode();
  const posViewportWidth = usePosViewportWidth();
  const { level: displayScaleLevel } = useDisplayScale();
  const displayScaleMultiplier = DISPLAY_SCALE_META[displayScaleLevel].multiplier;
  const isFullDesktopPos = posLayoutMode === "full";

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const canDispense = actorHasEffectivePermission(actor, "pos.sell", snapshot, authMode);
  const todaySalesSummary = useMemo(() => summarizeTodaySales(sales), [sales]);
  const pendingCount = useMemo(() => pendingSales(sales).length, [sales]);
  const activeShift = useMemo(
    () => (preferences.shifts ?? []).find((sh) => !sh.endAt && sh.actorUserId === actor.userId) ?? null,
    [preferences.shifts, actor.userId],
  );

  const queue = useMemo(() => activePrescriptionQueue(prescriptions), [prescriptions]);
  const selectedRx = useMemo(
    () => prescriptions.find((r) => r.id === selectedRxId) ?? null,
    [prescriptions, selectedRxId],
  );
  const selectedPatient = useMemo(
    () => customers.find((c) => c.id === selectedPatientId) ?? null,
    [customers, selectedPatientId],
  );

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const checkout = usePharmacyDispenseCheckout({
    lang,
    actorRole: actor.role,
    actorPermissions: actor.permissions,
    selectedPatientId,
    selectedRxId,
    onDispenseSuccess: () => {
      setSelectedRxId(null);
      if (contextMode === "walk_in") setSelectedPatientId(null);
    },
    onToast: flash,
  });

  const receiptSale = useMemo(
    () => sales.find((s) => s.id === checkout.receiptSaleId) ?? null,
    [sales, checkout.receiptSaleId],
  );
  const receiptCtx = useMemo(() => {
    if (!receiptSale) return null;
    const cust = receiptSale.customerId ? customers.find((c) => c.id === receiptSale.customerId) : null;
    return buildSaleReceiptContext({
      lang,
      sale: receiptSale,
      allSales: sales,
      preferences,
      products,
      actor,
      customerName: cust?.name ?? null,
      customerBalanceUgx: cust?.debtBalanceUgx ?? null,
    });
  }, [receiptSale, customers, lang, sales, preferences, products, actor]);

  const checkoutTotalsForDiscount = useMemo(
    () => computeDraftCheckoutTotals(draftLines, draftCartDiscountUgx),
    [draftLines, draftCartDiscountUgx],
  );

  const basketProductIds = useMemo(() => {
    const ids = draftLines.map((l) => l.productId);
    if (selectedRx) ids.push(...selectedRx.lines.map((l) => l.productId));
    return [...new Set(ids)];
  }, [draftLines, selectedRx]);

  const mountDesktopCheckoutSidebar = shouldMountDesktopCheckoutSidebar(
    posLayoutMode,
    products.length > 0,
    draftLines.length,
    saleCheckoutMinimized,
  );
  const useDesktopCatalogCheckoutDock = isFullDesktopPos && mountDesktopCheckoutSidebar;
  const posSplitColumns =
    mountDesktopCheckoutSidebar && isFullDesktopPos
      ? posSplitGridTemplateColumns(posViewportWidth, displayScaleMultiplier)
      : null;
  const mountCompactCheckoutSlideover = shouldMountCompactCheckoutSlideover(
    posLayoutMode,
    draftLines.length,
    saleCheckoutMinimized,
  );
  const mountMobileCheckoutOverlay = shouldMountMobileCheckoutOverlay(
    posLayoutMode,
    draftLines.length,
    saleCheckoutMinimized,
  );
  const showMinimizedCheckoutFab = shouldShowMinimizedCheckoutFab(
    posLayoutMode,
    draftLines.length,
    saleCheckoutMinimized,
  );

  const contextDisplayLabel = useMemo(() => {
    if (selectedRx) return `${selectedRx.prescriptionNumber} · ${selectedRx.patientName ?? t(lang, "pharmacyRxWalkIn")}`;
    if (selectedPatient) return selectedPatient.name;
    return t(lang, "pharmacyDispenseWalkIn");
  }, [selectedRx, selectedPatient, lang]);

  useEffect(() => {
    if (otcMode) {
      setPharmacyDispenseMode("otc");
      setContextMode("walk_in");
      setSelectedRxId(null);
    }
  }, [otcMode, setPharmacyDispenseMode]);

  useEffect(() => {
    if (!patientParam) return;
    if (customers.some((c) => c.id === patientParam)) {
      setSelectedPatientId(patientParam);
      setContextMode("existing_patient");
    }
  }, [patientParam, customers]);

  const handleContextModeChange = (mode: PharmacyCustomerContextMode) => {
    setContextMode(mode);
    if (mode === "walk_in") {
      setSelectedPatientId(null);
      setSelectedRxId(null);
      setPharmacyDispenseMode("otc");
      return;
    }
    if (mode === "existing_patient") setPatientSearchOpen(true);
    if (mode === "new_patient") setNewPatientOpen(true);
    if (mode === "prescription_queue") setRxQueueOpen(true);
  };

  const attachPatient = (patientId: string) => {
    setSelectedPatientId(patientId);
    setContextMode("existing_patient");
  };

  const handleSelectRx = (rxId: string) => {
    const rx = prescriptions.find((r) => r.id === rxId);
    setSelectedRxId(rxId);
    setContextMode("prescription_queue");
    setPharmacyDispenseMode("prescription");
    if (rx?.patientId) setSelectedPatientId(rx.patientId);
    if (rx && ["verified", "ready", "dispensing"].includes(rx.status)) {
      const r = loadPrescriptionToDraft(rxId);
      if (!r.ok) flash(t(lang, r.errorKey ?? "invalid"));
    }
  };

  const startNewRx = (type: PharmacyPrescriptionType = "paper_rx") => {
    const r = createPharmacyPrescription({
      type,
      patientId: selectedPatient?.id ?? null,
      patientName: selectedPatient?.name ?? null,
      patientPhone: selectedPatient?.phone ?? null,
    });
    if (r.ok && r.prescriptionId) {
      setSelectedRxId(r.prescriptionId);
      setPharmacyDispenseMode("prescription");
      setContextMode("prescription_queue");
    }
  };

  const addMedicineToRx = (productId: string) => {
    if (!selectedRx) return;
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const updated = addLineToPrescription(selectedRx, product, 1, null);
    updatePharmacyPrescription(selectedRx.id, { lines: updated.lines });
  };

  const addToBasket = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setDraftInput({ product, inputMode: "quantity", value: 1 });
    const r = addDraftLineFromInput();
    if (!r.ok) flash(t(lang, r.errorKey ?? "invalid"));
  };

  const handleMedicinePick = (productId: string) => {
    if (activePharmacyPrescriptionId && selectedRxId === activePharmacyPrescriptionId) {
      setPharmacyDispenseMode("prescription");
      addToBasket(productId);
      return;
    }
    if (selectedRx) {
      addMedicineToRx(productId);
      return;
    }
    setPharmacyDispenseMode("otc");
    addToBasket(productId);
  };

  const focusCatalogForAdd = useCallback(() => {
    setCatalogNumpadOpen(false);
    if (isFullDesktopPos) setSaleCheckoutMinimized(true);
    catalogRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [isFullDesktopPos]);

  const checkoutExtras = {
    onBatchTap: setBatchPickerLine,
    onQtyTap: setQtyEditLine,
    onLineDiscount: setDiscountLine,
    onOpenCartDiscount: () => setCartSaleDiscountOpen(true),
    onMinimize: () => setSaleCheckoutMinimized(true),
    onAddItems: focusCatalogForAdd,
    catalogDock: useDesktopCatalogCheckoutDock,
    catalogNumpadOpen,
    onCatalogNumpadOpenChange: setCatalogNumpadOpen,
  };

  if (!pharmacy || !canDispense) return null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-stone-100">
      <PosOfflineBanner lang={lang} compact />
      {isFullDesktopPos ? (
        <PosDesktopCompactHeader
          lang={lang}
          sellLabelKey="navDispense"
          cashierName={actor.displayName ?? actor.userId}
          shift={activeShift}
          todaySaleCount={todaySalesSummary.count}
          todaySalesUgx={todaySalesSummary.total}
          pendingCount={pendingCount}
          onCloseShift={() => setShiftCloseOpen(true)}
          exitTo={POS_HOME_ROUTE}
        />
      ) : null}

      <PharmacyCustomerContextBar
        lang={lang}
        mode={contextMode}
        displayLabel={contextDisplayLabel}
        onModeChange={handleContextModeChange}
      />

      {selectedPatient ? (
        <PharmacyPatientContextPanel
          lang={lang}
          patient={selectedPatient}
          selectedRx={selectedRx}
          prescriptions={prescriptions}
          sales={sales}
          products={products}
          basketProductIds={basketProductIds}
        />
      ) : null}

      {selectedRx ? (
        <PharmacyRxActionBar
          lang={lang}
          rx={selectedRx}
          preferences={preferences}
          onSubmitVerify={() => {
            transitionPharmacyPrescription(selectedRx.id, "waiting_verification");
            flash(t(lang, "pharmacyRxStatusWaiting"));
          }}
          onVerify={() => {
            if (prescriptionHasControlledMedicines(selectedRx, products) && !selectedRx.controlledMedicinesApproved) {
              setControlledOpen(true);
              return;
            }
            setVerifyOpen(true);
          }}
          onBeginDispense={() => {
            const r = loadPrescriptionToDraft(selectedRx.id);
            flash(r.ok ? t(lang, "pharmacyRxDispensing") : t(lang, r.errorKey ?? "invalid"));
          }}
          onRefill={() => {
            const r = createPharmacyRefill(selectedRx.id);
            if (r.ok && r.prescriptionId) setSelectedRxId(r.prescriptionId);
          }}
        />
      ) : null}

      {toast ? (
        <p className="mx-2 mt-1 shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950">
          {toast}
        </p>
      ) : null}

      <div
        className={clsx(
          "min-h-0 flex-1",
          mountDesktopCheckoutSidebar && isFullDesktopPos && "grid items-stretch gap-1.5",
        )}
        style={posSplitColumns ? { gridTemplateColumns: posSplitColumns } : undefined}
      >
        <div ref={catalogRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SellProductBrowsePanel
            lang={lang}
            products={products}
            preferences={preferences}
            ephemeralCategory
            onPick={(p) => handleMedicinePick(p.id)}
            onBarcodeNotFound={() => flash(t(lang, "posBarcodeNotFound"))}
            searchPlaceholder={t(lang, "pharmacyRxAddMedicinePh")}
            className="min-h-0 flex-1 px-1 pt-1"
          />
        </div>

        {mountDesktopCheckoutSidebar ? (
          <aside className="sticky top-0 min-h-0 self-stretch">
            <PharmacyCheckoutMetaStrip
              lang={lang}
              selectedRx={selectedRx}
              products={products}
              draftLines={draftLines}
              dispenseMode={pharmacyDispenseMode}
            />
            <PosCheckoutPanel {...checkout.buildCheckoutPanelProps({ ...checkoutExtras, variant: "sidebar" })} />
          </aside>
        ) : null}
      </div>

      {mountCompactCheckoutSlideover ? (
        <PosCompactCheckoutSlideover
          open
          onClose={() => setSaleCheckoutMinimized(true)}
          checkoutBottomPad="env(safe-area-inset-bottom, 0px)"
        >
          <PharmacyCheckoutMetaStrip
            lang={lang}
            selectedRx={selectedRx}
            products={products}
            draftLines={draftLines}
            dispenseMode={pharmacyDispenseMode}
          />
          <PosCheckoutPanel {...checkout.buildCheckoutPanelProps({ ...checkoutExtras, variant: "overlay" })} />
        </PosCompactCheckoutSlideover>
      ) : null}

      {mountMobileCheckoutOverlay ? (
        <PosScreenPortal>
          <div
            className="waka-overlay-full fixed inset-0 z-[var(--waka-z-pos-overlay)] flex min-h-0 flex-col bg-white pt-[env(safe-area-inset-top,0px)] md:hidden"
            role="dialog"
            aria-modal
          >
            <PharmacyCheckoutMetaStrip
              lang={lang}
              selectedRx={selectedRx}
              products={products}
              draftLines={draftLines}
              dispenseMode={pharmacyDispenseMode}
            />
            <PosCheckoutPanel {...checkout.buildCheckoutPanelProps({ ...checkoutExtras, variant: "overlay" })} />
          </div>
        </PosScreenPortal>
      ) : null}

      {showMinimizedCheckoutFab ? (
        <PosMinimizedCheckoutFab
          lang={lang}
          variant={posLayoutMode === "mobile" ? "mobile" : "compact"}
          productCount={checkout.draftCartStats.productCount}
          unitCount={String(checkout.draftCartStats.unitCount)}
          payableUgx={checkout.draftPayable}
          onOpen={() => setSaleCheckoutMinimized(false)}
        />
      ) : null}

      <PharmacyPatientSearchDrawer
        lang={lang}
        open={patientSearchOpen}
        customers={customers}
        prescriptions={prescriptions}
        products={products}
        onClose={() => setPatientSearchOpen(false)}
        onSelect={attachPatient}
      />

      <PharmacyNewPatientDrawer
        lang={lang}
        open={newPatientOpen}
        onClose={() => setNewPatientOpen(false)}
        onSave={attachPatient}
        addCustomer={addCustomer}
      />

      <PharmacyPrescriptionQueueDrawer
        lang={lang}
        open={rxQueueOpen}
        queue={queue}
        selectedRxId={selectedRxId}
        onClose={() => setRxQueueOpen(false)}
        onSelect={handleSelectRx}
        onNewRx={() => startNewRx("paper_rx")}
      />

      {selectedRx ? (
        <PharmacyVerificationSheet
          lang={lang}
          prescription={selectedRx}
          products={products}
          patient={selectedPatient}
          open={verifyOpen}
          onClose={() => setVerifyOpen(false)}
          onConfirm={() => {
            verifyPharmacyPrescription(selectedRx.id);
            setVerifyOpen(false);
            flash(t(lang, "pharmacyRxStatusVerified"));
          }}
        />
      ) : null}

      {selectedRx ? (
        <PharmacyControlledApprovalModal
          lang={lang}
          open={controlledOpen}
          prescriptionNumber={selectedRx.prescriptionNumber}
          onClose={() => setControlledOpen(false)}
          onApproved={(reason) => {
            approveControlledDispense(selectedRx.id, reason);
            setVerifyOpen(true);
          }}
        />
      ) : null}

      {checkout.controlledCheckout.hasControlledLines ? (
        <PharmacyControlledDispenseGate
          lang={lang}
          open={checkout.controlledCheckout.gateOpen}
          validation={checkout.controlledCheckout.validation}
          prescription={selectedRx}
          patientName={selectedPatient?.name ?? selectedRx?.patientName ?? null}
          onClose={() => checkout.controlledCheckout.setGateOpen(false)}
          onApproved={checkout.onControlledGateApproved}
        />
      ) : null}

      {batchPickerLine && products.find((p) => p.id === batchPickerLine.productId) ? (
        <PharmacyFefoBatchPicker
          lang={lang}
          product={products.find((p) => p.id === batchPickerLine.productId)!}
          line={batchPickerLine}
          onClose={() => setBatchPickerLine(null)}
          onConfirm={(batchId, reason) => {
            setDraftLineBatchOverride(batchPickerLine.productId, batchId, reason);
            setBatchPickerLine(null);
          }}
        />
      ) : null}

      <DiscountLineModal
        lang={lang}
        open={discountLine !== null}
        line={discountLine}
        onClose={() => setDiscountLine(null)}
        onApply={(newSellingPriceUgx) => {
          if (!discountLine) return;
          const r = applyDraftLineDiscount(discountLine.productId, "final", newSellingPriceUgx);
          if (!r.ok) flash(t(lang, r.errorKey ?? "saleError"));
          setDiscountLine(null);
        }}
      />

      <CartSaleDiscountModal
        lang={lang}
        open={cartSaleDiscountOpen}
        lineSubtotalUgx={checkoutTotalsForDiscount.lineSubtotalUgx}
        currentDiscountUgx={draftCartDiscountUgx}
        onClose={() => setCartSaleDiscountOpen(false)}
        onApply={(discountUgx) => {
          const r = setDraftCartDiscount(discountUgx);
          if (!r.ok) flash(t(lang, r.errorKey ?? "saleError"));
          setCartSaleDiscountOpen(false);
        }}
      />

      {qtyEditLine ? (
        <QuantityEditModal
          lang={lang}
          open
          productName={qtyEditLine.name}
          qtyLabel={
            products.find((p) => p.id === qtyEditLine.productId)
              ? formatDraftLineQty(products.find((p) => p.id === qtyEditLine.productId)!, qtyEditLine)
              : String(qtyEditLine.quantity)
          }
          initialQuantity={qtyEditLine.quantity}
          onClose={() => setQtyEditLine(null)}
          onConfirm={(quantity) => {
            const r = checkout.setDraftLineQuantity(qtyEditLine.productId, quantity);
            if (!r.ok) flash(t(lang, r.errorKey ?? "saleError"));
            setQtyEditLine(null);
          }}
        />
      ) : null}

      <ShiftCloseModal
        lang={lang}
        open={shiftCloseOpen}
        shift={activeShift}
        onClose={() => setShiftCloseOpen(false)}
        onConfirm={(counted, handoff) => {
          const r = closeShiftWithCashCount(counted, handoff);
          if (!r.ok) {
            flash(t(lang, r.errorKey ?? "saleError"));
            return { ok: false };
          }
          flash(t(lang, "shiftCloseConfirm"));
          return { ok: true };
        }}
      />

      {receiptSale && receiptCtx ? (
        <PosScreenPortal>
          <div className="waka-overlay-full fixed inset-0 z-[var(--waka-z-pos-overlay)] flex min-h-0 flex-col bg-white pt-[env(safe-area-inset-top,0px)]">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
              <h2 className="text-xl font-black text-stone-900">{t(lang, "receiptTitle")}</h2>
              <button
                type="button"
                onClick={() => checkout.setReceiptSaleId(null)}
                className="min-h-[44px] rounded-xl border-2 border-stone-200 px-4 py-2 text-sm font-bold"
              >
                {t(lang, "receiptClose")}
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
              <p className="text-center text-sm font-semibold text-stone-600">{t(lang, "pharmacyRxDispensed")}</p>
              <DocumentActionsBar
                lang={lang}
                onPrint={() => {
                  void printSaleReceipt(receiptCtx).then((r) => {
                    if (r.ok) logReceiptReprintAudit(receiptSale, receiptCtx.receiptNumber);
                  });
                }}
                onDownloadPdf={() => {
                  void downloadSaleReceiptPdf(receiptCtx).then((ok) => {
                    if (ok) logReceiptPdfExportAudit(receiptSale, receiptCtx.receiptNumber);
                  });
                }}
                onSharePdf={() => void shareSaleReceiptPdf(receiptCtx)}
              />
            </div>
          </div>
        </PosScreenPortal>
      ) : null}
    </div>
  );
}

export function PharmacyDispenseWorkspaceWithGateway({ lang }: Props) {
  return (
    <ShiftSellGateway lang={lang}>
      <PharmacyDispenseWorkspace lang={lang} />
    </ShiftSellGateway>
  );
}
