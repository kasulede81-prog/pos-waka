import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Language, SaleLine, UserRole } from "../types";
import { usePosStore } from "../store/usePosStore";
import { usePharmacyControlledCheckout } from "./usePharmacyControlledCheckout";
import { computeDraftCartStats, computeDraftCheckoutTotals, draftLineQuantityStep } from "../lib/draftCart";
import { parseDisplayMoney } from "../lib/posCheckoutMoney";
import { gateDraftSaleStockBeforeFinalize } from "../lib/preFinalizeStockGate";
import { hasPermission } from "../lib/permissions";
import { t } from "../lib/i18n";
import type { PosCheckoutPanelProps } from "../components/pos/PosCheckoutPanel";

type PaymentMethod = PosCheckoutPanelProps["paymentMethod"];
type CheckoutAmountField = PosCheckoutPanelProps["checkoutAmountField"];

const POS_CHECKOUT_METHODS: PaymentMethod[] = ["cash", "atm", "mobile_money", "credit"];

type UsePharmacyDispenseCheckoutOpts = {
  lang: Language;
  actorRole: UserRole;
  selectedPatientId: string | null;
  selectedRxId: string | null;
  onDispenseSuccess?: () => void;
  onToast?: (message: string) => void;
};

export function usePharmacyDispenseCheckout({
  lang,
  actorRole,
  selectedPatientId,
  selectedRxId,
  onDispenseSuccess,
  onToast,
}: UsePharmacyDispenseCheckoutOpts) {
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);
  const customers = usePosStore((s) => s.customers);
  const draftLines = usePosStore((s) => s.draftLines);
  const draftCartDiscountUgx = usePosStore((s) => s.draftCartDiscountUgx);
  const prescriptions = usePosStore((s) => s.pharmacyPrescriptions);
  const finalizeDraftSale = usePosStore((s) => s.finalizeDraftSale);
  const clearDraft = usePosStore((s) => s.clearDraft);
  const removeDraftLine = usePosStore((s) => s.removeDraftLine);
  const adjustDraftLineQuantity = usePosStore((s) => s.adjustDraftLineQuantity);
  const setDraftLineQuantity = usePosStore((s) => s.setDraftLineQuantity);
  const savePendingSale = usePosStore((s) => s.savePendingSale);

  const selectedRx = useMemo(
    () => prescriptions.find((r) => r.id === selectedRxId) ?? null,
    [prescriptions, selectedRxId],
  );
  const controlledCheckout = usePharmacyControlledCheckout(selectedRx);

  const canSavePending = hasPermission(actorRole, "pending_sales.manage");
  const canIssueDebt = hasPermission(actorRole, "customers.debt");
  const checkoutMethods = useMemo(
    () => POS_CHECKOUT_METHODS.filter((m) => m !== "credit" || canIssueDebt),
    [canIssueDebt],
  );

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [mobileMoneyInput, setMobileMoneyInput] = useState("");
  const [checkoutAmountField, setCheckoutAmountField] = useState<CheckoutAmountField>("cash");
  const [saleCustomerId, setSaleCustomerId] = useState("");
  const [saleCustomerName, setSaleCustomerName] = useState("");
  const [saleCustomerPhone, setSaleCustomerPhone] = useState("");
  const [checkoutBlockMessage, setCheckoutBlockMessage] = useState<string | null>(null);
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);

  const customerSelectRef = useRef<HTMLSelectElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const checkoutPanelRef = useRef<HTMLDivElement>(null);
  const pendingFinalizeOptsRef = useRef<Parameters<typeof finalizeDraftSale>[0] | null>(null);

  useEffect(() => {
    if (paymentMethod === "credit" && !canIssueDebt) setPaymentMethod("cash");
  }, [paymentMethod, canIssueDebt]);

  useEffect(() => {
    if (!selectedPatientId) return;
    const patient = customers.find((c) => c.id === selectedPatientId);
    if (!patient) return;
    setSaleCustomerId(patient.id);
    setSaleCustomerName(patient.name);
    setSaleCustomerPhone(patient.phone ?? "");
  }, [selectedPatientId, customers]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const draftCartStats = useMemo(() => computeDraftCartStats(draftLines), [draftLines]);
  const checkoutTotals = useMemo(
    () => computeDraftCheckoutTotals(draftLines, draftCartDiscountUgx),
    [draftLines, draftCartDiscountUgx],
  );
  const draftPayable = checkoutTotals.payableUgx;
  const draftDiscountTotal = checkoutTotals.cartDiscountUgx;

  const totalPaidInput = useMemo(() => {
    const cash = parseDisplayMoney(cashInput);
    const mobile = parseDisplayMoney(mobileMoneyInput);
    if (paymentMethod === "cash") return cash > 0 ? cash : draftPayable;
    if (paymentMethod === "atm" || paymentMethod === "mobile_money") return draftPayable;
    if (paymentMethod === "credit") return cash + mobile;
    return cash + mobile;
  }, [paymentMethod, cashInput, mobileMoneyInput, draftPayable]);

  const changeDue = useMemo(() => {
    if (paymentMethod === "mobile_money" || paymentMethod === "atm") return 0;
    return Math.max(0, totalPaidInput - draftPayable);
  }, [paymentMethod, totalPaidInput, draftPayable]);

  const computedDebt = useMemo(() => {
    if (paymentMethod === "cash" || paymentMethod === "mobile_money" || paymentMethod === "atm") return 0;
    return Math.max(0, draftPayable - totalPaidInput);
  }, [paymentMethod, draftPayable, totalPaidInput]);

  const appendCheckoutDigit = useCallback(
    (d: string) => {
      const apply = (prev: string) => {
        if (d === "back") return prev.slice(0, -1);
        return (prev + d).replace(/\D/g, "").slice(0, 10);
      };
      if (checkoutAmountField === "mobile") setMobileMoneyInput(apply);
      else setCashInput(apply);
    },
    [checkoutAmountField],
  );

  const clearCheckoutAmount = useCallback(() => {
    if (checkoutAmountField === "mobile") setMobileMoneyInput("");
    else setCashInput("");
  }, [checkoutAmountField]);

  const toast = useCallback(
    (message: string) => {
      onToast?.(message);
    },
    [onToast],
  );

  const resetCheckoutFields = useCallback(() => {
    setCashInput("");
    setMobileMoneyInput("");
    setCheckoutAmountField("cash");
    setPaymentMethod("cash");
    setCheckoutBlockMessage(null);
  }, []);

  const applyFinalizeSuccess = useCallback(
    (r: ReturnType<typeof finalizeDraftSale>) => {
      resetCheckoutFields();
      if (!selectedPatientId) {
        setSaleCustomerId("");
        setSaleCustomerName("");
        setSaleCustomerPhone("");
      }
      if (r.saleId) setReceiptSaleId(r.saleId);
      onDispenseSuccess?.();
      toast(t(lang, "pharmacyRxDispensed"));
    },
    [resetCheckoutFields, selectedPatientId, onDispenseSuccess, toast, lang],
  );

  const onControlledGateApproved = useCallback(() => {
    const opts = pendingFinalizeOptsRef.current;
    controlledCheckout.setGateOpen(false);
    if (!opts) return;
    const r = controlledCheckout.runFinalize(opts);
    pendingFinalizeOptsRef.current = null;
    if (!r.ok) {
      const msg = t(lang, r.errorKey ?? "saleError");
      if (r.errorKey === "pharmacyExpiredSaleBlocked") setCheckoutBlockMessage(msg);
      toast(msg);
      return;
    }
    applyFinalizeSuccess(r);
  }, [controlledCheckout, lang, applyFinalizeSuccess, toast]);

  const finishSale = useCallback(() => {
    void (async () => {
      if (paymentMethod === "cash" && parseDisplayMoney(cashInput) > 0 && parseDisplayMoney(cashInput) < draftPayable) {
        toast(t(lang, "paymentCashTooLow"));
        return;
      }
      const debt = paymentMethod === "credit" || paymentMethod === "mixed" ? computedDebt : 0;
      const customerId = saleCustomerId || selectedPatientId || selectedRx?.patientId || null;
      const customerName = saleCustomerName.trim() || selectedRx?.patientName || null;
      const customerPhone = saleCustomerPhone.trim() || selectedRx?.patientPhone || null;
      if (debt > 0 && !customerId && !customerName) {
        toast(t(lang, "debtRequiresCustomerName"));
        return;
      }
      const stockGate = await gateDraftSaleStockBeforeFinalize(preferences, draftLines);
      if (!stockGate.ok) {
        toast(t(lang, stockGate.errorKey));
        return;
      }
      const finalizeOpts = {
        debtUgx: debt,
        customerId,
        customerName,
        customerPhone,
        paymentMethod,
        amountPaidUgx: totalPaidInput,
        changeGivenUgx: changeDue,
      };
      const r = controlledCheckout.attemptFinalize(finalizeOpts);
      if (!r.ok) {
        if (r.errorKey === "pharmacyControlledApprovalRequired") {
          pendingFinalizeOptsRef.current = finalizeOpts;
          return;
        }
        const msg = t(lang, r.errorKey ?? "saleError");
        if (r.errorKey === "pharmacyExpiredSaleBlocked") setCheckoutBlockMessage(msg);
        toast(msg);
        return;
      }
      applyFinalizeSuccess(r);
    })();
  }, [
    paymentMethod,
    cashInput,
    draftPayable,
    computedDebt,
    saleCustomerId,
    saleCustomerName,
    saleCustomerPhone,
    selectedPatientId,
    selectedRx,
    preferences,
    draftLines,
    totalPaidInput,
    changeDue,
    controlledCheckout,
    lang,
    applyFinalizeSuccess,
    toast,
  ]);

  const handleSavePending = useCallback(() => {
    if (!canSavePending || draftLines.length === 0) return;
    const label = saleCustomerName.trim() || undefined;
    const res = savePendingSale(label);
    if (!res.ok) {
      toast(t(lang, res.errorKey ?? "saleError"));
      return;
    }
    resetCheckoutFields();
    toast(t(lang, "pendingSaved"));
  }, [canSavePending, draftLines.length, saleCustomerName, savePendingSale, lang, resetCheckoutFields, toast]);

  const handleDraftQtyStep = useCallback(
    (line: SaleLine, backwards: boolean) => {
      const product = productById.get(line.productId);
      const delta = product ? draftLineQuantityStep(product, backwards) : backwards ? -1 : 1;
      const res = adjustDraftLineQuantity(line.productId, delta);
      if (!res.ok) toast(t(lang, res.errorKey ?? "saleError"));
    },
    [productById, adjustDraftLineQuantity, lang, toast],
  );

  const customerRows = useMemo(
    () => customers.map((c) => ({ id: c.id, name: c.name, debtBalanceUgx: c.debtBalanceUgx })),
    [customers],
  );

  const buildCheckoutPanelProps = useCallback(
    (extras: {
      onBatchTap?: (line: SaleLine) => void;
      onQtyTap: (line: SaleLine) => void;
      onLineDiscount: (line: SaleLine) => void;
      onOpenCartDiscount: () => void;
      onMinimize?: () => void;
      onAddItems?: () => void;
      catalogDock?: boolean;
      catalogNumpadOpen?: boolean;
      onCatalogNumpadOpenChange?: (open: boolean) => void;
      variant: "sidebar" | "overlay";
    }): PosCheckoutPanelProps => ({
      lang,
      variant: extras.variant,
      saleTitle: t(lang, "thisSale"),
      clearSaleLabel: t(lang, "clearSale"),
      saveSaleLabel: t(lang, "saveSale"),
      draftLines,
      draftCartStats,
      checkoutTotals,
      draftPayable,
      draftDiscountTotal,
      productById,
      checkoutBlockMessage,
      paymentMethod,
      checkoutMethods,
      cashInput,
      mobileMoneyInput,
      checkoutAmountField,
      changeDue,
      computedDebt,
      saleCustomerId,
      saleCustomerName,
      saleCustomerPhone,
      customers: customerRows,
      canSavePending,
      savePendingLabel: t(lang, "saveAsPending"),
      customerSelectRef: customerSelectRef as RefObject<HTMLSelectElement | null>,
      saveButtonRef: saveButtonRef as RefObject<HTMLButtonElement | null>,
      checkoutPanelRef: checkoutPanelRef as RefObject<HTMLDivElement | null>,
      onClearDraft: clearDraft,
      onIncrement: (line) => handleDraftQtyStep(line, false),
      onDecrement: (line) => handleDraftQtyStep(line, true),
      onQtyTap: extras.onQtyTap,
      onLineDiscount: extras.onLineDiscount,
      onRemoveLine: removeDraftLine,
      onOpenCartDiscount: extras.onOpenCartDiscount,
      pharmacyMode: true,
      onBatchTap: extras.onBatchTap,
      onPaymentMethod: setPaymentMethod,
      onCheckoutAmountField: setCheckoutAmountField,
      onAppendCheckoutDigit: appendCheckoutDigit,
      onClearCheckoutAmount: clearCheckoutAmount,
      onSaleCustomerId: setSaleCustomerId,
      onSaleCustomerName: setSaleCustomerName,
      onSaleCustomerPhone: setSaleCustomerPhone,
      onSavePending: handleSavePending,
      onFinishSale: finishSale,
      onMinimize: extras.onMinimize,
      onAddItems: extras.onAddItems,
      catalogDock: extras.catalogDock,
      catalogNumpadOpen: extras.catalogNumpadOpen,
      onCatalogNumpadOpenChange: extras.onCatalogNumpadOpenChange,
    }),
    [
      lang,
      draftLines,
      draftCartStats,
      checkoutTotals,
      draftPayable,
      draftDiscountTotal,
      productById,
      checkoutBlockMessage,
      paymentMethod,
      checkoutMethods,
      cashInput,
      mobileMoneyInput,
      checkoutAmountField,
      changeDue,
      computedDebt,
      saleCustomerId,
      saleCustomerName,
      saleCustomerPhone,
      customerRows,
      canSavePending,
      clearDraft,
      handleDraftQtyStep,
      removeDraftLine,
      appendCheckoutDigit,
      clearCheckoutAmount,
      handleSavePending,
      finishSale,
    ],
  );

  return {
    controlledCheckout,
    onControlledGateApproved,
    receiptSaleId,
    setReceiptSaleId,
    checkoutBlockMessage,
    setCheckoutBlockMessage,
    buildCheckoutPanelProps,
    setDraftLineQuantity: (productId: string, quantity: number) => {
      const res = setDraftLineQuantity(productId, quantity);
      return res;
    },
    draftPayable,
    draftCartStats,
  };
}
