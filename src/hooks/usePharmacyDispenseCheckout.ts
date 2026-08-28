import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Language, Permission, SaleLine, UserRole } from "../types";
import { usePosStore } from "../store/usePosStore";
import { usePharmacyControlledCheckout } from "./usePharmacyControlledCheckout";
import { computeDraftCartStats, computeDraftCheckoutTotals, draftLineQuantityStep } from "../lib/draftCart";
import { parseDisplayMoney } from "../lib/posCheckoutMoney";
import {
  applyCheckoutAlphaKey,
  applyCheckoutNumericKey,
  applyCheckoutPhoneKey,
  preferredKeypadModeForField,
  type CheckoutInputField,
  type CheckoutKeypadMode,
} from "../lib/posCheckoutKeypad";
import { gateDraftSaleStockBeforeFinalize } from "../lib/preFinalizeStockGate";
import { hasActorPermission } from "../lib/permissions";
import { t } from "../lib/i18n";
import { useCartAbandonVoid } from "./useCartAbandonVoid";
import type { PosCheckoutPanelProps } from "../components/pos/PosCheckoutPanel";

type FinalizeDraftSaleFn = ReturnType<typeof usePosStore.getState>["finalizeDraftSale"];
type FinalizeDraftSaleOpts = Parameters<FinalizeDraftSaleFn>[0];
type FinalizeDraftSaleResult = ReturnType<FinalizeDraftSaleFn>;
type PaymentMethod = PosCheckoutPanelProps["paymentMethod"];
type CheckoutAmountField = CheckoutInputField;

const POS_CHECKOUT_METHODS: PaymentMethod[] = ["cash", "atm", "mobile_money", "credit"];

type UsePharmacyDispenseCheckoutOpts = {
  lang: Language;
  actorRole: UserRole;
  actorPermissions?: Permission[] | null;
  selectedPatientId: string | null;
  selectedRxId: string | null;
  onDispenseSuccess?: () => void;
  onToast?: (message: string) => void;
};

export function usePharmacyDispenseCheckout({
  lang,
  actorRole,
  actorPermissions,
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
  const setDraftPaymentMethod = usePosStore((s) => s.setDraftPaymentMethod);
  const setDraftSaleCustomer = usePosStore((s) => s.setDraftSaleCustomer);
  const storedDraftPaymentMethod = usePosStore((s) => s.draftPaymentMethod);
  const saleCustomerId = usePosStore((s) => s.draftSaleCustomerId);
  const saleCustomerName = usePosStore((s) => s.draftSaleCustomerName);
  const saleCustomerPhone = usePosStore((s) => s.draftSaleCustomerPhone);
  const savePendingSale = usePosStore((s) => s.savePendingSale);

  const selectedRx = useMemo(
    () => prescriptions.find((r) => r.id === selectedRxId) ?? null,
    [prescriptions, selectedRxId],
  );
  const controlledCheckout = usePharmacyControlledCheckout(selectedRx);

  const canSavePending = hasActorPermission(actorRole, "pending_sales.manage", actorPermissions);
  const canIssueDebt = hasActorPermission(actorRole, "customers.debt", actorPermissions);
  const checkoutMethods = useMemo(
    () => POS_CHECKOUT_METHODS.filter((m) => m !== "credit" || canIssueDebt),
    [canIssueDebt],
  );

  const paymentMethod: PaymentMethod =
    storedDraftPaymentMethod === "voucher" || (storedDraftPaymentMethod === "credit" && !canIssueDebt)
      ? "cash"
      : storedDraftPaymentMethod;
  const setPaymentMethod = useCallback(
    (method: PaymentMethod) => setDraftPaymentMethod(method),
    [setDraftPaymentMethod],
  );
  const setSaleCustomerId = useCallback(
    (id: string) => setDraftSaleCustomer({ customerId: id }),
    [setDraftSaleCustomer],
  );
  const setSaleCustomerName = useCallback(
    (name: string) => setDraftSaleCustomer({ customerName: name }),
    [setDraftSaleCustomer],
  );
  const setSaleCustomerPhone = useCallback(
    (phone: string) => setDraftSaleCustomer({ customerPhone: phone }),
    [setDraftSaleCustomer],
  );
  const [cashInput, setCashInput] = useState("");
  const [mobileMoneyInput, setMobileMoneyInput] = useState("");
  const [checkoutAmountField, setCheckoutAmountField] = useState<CheckoutAmountField>("cash");
  const [checkoutKeypadMode, setCheckoutKeypadMode] = useState<CheckoutKeypadMode>("numeric");
  const [checkoutBlockMessage, setCheckoutBlockMessage] = useState<string | null>(null);
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);
  const finishSaleInFlightRef = useRef(false);

  const customerSelectRef = useRef<HTMLSelectElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const checkoutPanelRef = useRef<HTMLDivElement>(null);
  const pendingFinalizeOptsRef = useRef<FinalizeDraftSaleOpts | null>(null);

  useEffect(() => {
    if (!selectedPatientId) return;
    const patient = customers.find((c) => c.id === selectedPatientId);
    if (!patient) return;
    setDraftSaleCustomer({
      customerId: patient.id,
      customerName: patient.name,
      customerPhone: patient.phone ?? "",
    });
  }, [selectedPatientId, customers, setDraftSaleCustomer]);

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

  const handleCheckoutInputField = useCallback((field: CheckoutInputField) => {
    setCheckoutAmountField(field);
    setCheckoutKeypadMode(preferredKeypadModeForField(field));
  }, []);

  const appendCheckoutDigit = useCallback(
    (d: string) => {
      if (checkoutKeypadMode === "alpha" && checkoutAmountField === "customerName") {
        setSaleCustomerName(applyCheckoutAlphaKey(saleCustomerName, d));
        return;
      }
      const applyNumeric = (prev: string) => applyCheckoutNumericKey(prev, d);
      const applyPhone = (prev: string) => applyCheckoutPhoneKey(prev, d);
      switch (checkoutAmountField) {
        case "mobile":
          setMobileMoneyInput(applyPhone);
          break;
        case "customerPhone":
          setSaleCustomerPhone(applyPhone(saleCustomerPhone));
          break;
        case "customerName":
          setSaleCustomerName(applyCheckoutAlphaKey(saleCustomerName, d));
          break;
        default:
          setCashInput(applyNumeric);
      }
    },
    [checkoutAmountField, checkoutKeypadMode, saleCustomerName, saleCustomerPhone, setSaleCustomerName, setSaleCustomerPhone],
  );

  const clearCheckoutAmount = useCallback(() => {
    switch (checkoutAmountField) {
      case "mobile":
        setMobileMoneyInput("");
        break;
      case "customerPhone":
        setSaleCustomerPhone("");
        break;
      case "customerName":
        setSaleCustomerName("");
        break;
      default:
        setCashInput("");
    }
  }, [checkoutAmountField, setSaleCustomerName, setSaleCustomerPhone]);

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
    setCheckoutKeypadMode("numeric");
    setPaymentMethod("cash");
    setCheckoutBlockMessage(null);
  }, [setPaymentMethod]);

  const applyFinalizeSuccess = useCallback(
    (r: FinalizeDraftSaleResult) => {
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
    [resetCheckoutFields, selectedPatientId, onDispenseSuccess, toast, lang, setSaleCustomerId, setSaleCustomerName, setSaleCustomerPhone],
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
      if (finishSaleInFlightRef.current) return;
      finishSaleInFlightRef.current = true;
      try {
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
      } finally {
        finishSaleInFlightRef.current = false;
      }
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
    const res = savePendingSale();
    if (!res.ok) {
      toast(t(lang, res.errorKey ?? "saleError"));
      return;
    }
    resetCheckoutFields();
    if (!selectedPatientId) {
      setSaleCustomerId("");
      setSaleCustomerName("");
      setSaleCustomerPhone("");
    }
    toast(t(lang, "pendingSaved"));
  }, [canSavePending, draftLines.length, savePendingSale, lang, toast, resetCheckoutFields, selectedPatientId, setSaleCustomerId, setSaleCustomerName, setSaleCustomerPhone]);

  const cartAbandon = useCartAbandonVoid({
    lang,
    mode: "pharmacy",
    onAfterSuccessfulVoid: () => {
      resetCheckoutFields();
      if (!selectedPatientId) {
        setSaleCustomerId("");
        setSaleCustomerName("");
        setSaleCustomerPhone("");
      }
    },
    onError: (message) => toast(message),
  });

  const handleDraftQtyStep = useCallback(
    (line: SaleLine, backwards: boolean) => {
      const product = productById.get(line.productId);
      const delta = product ? draftLineQuantityStep(product, backwards) : backwards ? -1 : 1;
      const nextQty = Math.round((line.quantity + delta) * 10000) / 10000;
      const res = cartAbandon.requestSetLineQuantity(line.productId, nextQty);
      if (!res.ok) toast(t(lang, res.errorKey ?? "saleError"));
    },
    [productById, cartAbandon, lang, toast],
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
      clearSaleLabel: t(lang, "pharmacyTerm_clearBasket"),
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
      checkoutKeypadMode,
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
      onClearDraft: cartAbandon.requestClear,
      onIncrement: (line) => handleDraftQtyStep(line, false),
      onDecrement: (line) => handleDraftQtyStep(line, true),
      onQtyTap: extras.onQtyTap,
      onLineDiscount: extras.onLineDiscount,
      onRemoveLine: cartAbandon.requestRemoveLine,
      onOpenCartDiscount: extras.onOpenCartDiscount,
      pharmacyMode: true,
      onBatchTap: extras.onBatchTap,
      onPaymentMethod: setPaymentMethod,
      onCheckoutInputField: handleCheckoutInputField,
      onCheckoutKeypadModeChange: setCheckoutKeypadMode,
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
      checkoutKeypadMode,
      changeDue,
      computedDebt,
      saleCustomerId,
      saleCustomerName,
      saleCustomerPhone,
      customerRows,
      canSavePending,
      cartAbandon.requestClear,
      handleSavePending,
      finishSale,
      handleCheckoutInputField,
      appendCheckoutDigit,
      clearCheckoutAmount,
      handleDraftQtyStep,
      cartAbandon.requestRemoveLine,
      setPaymentMethod,
      setSaleCustomerId,
      setSaleCustomerName,
      setSaleCustomerPhone,
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
    cartVoidOpen: cartAbandon.open,
    cartVoidCopy: cartAbandon.copy,
    keepCartVoid: cartAbandon.keep,
    applyCartVoid: cartAbandon.apply,
    setDraftLineQuantity: cartAbandon.requestSetLineQuantity,
    draftPayable,
    draftCartStats,
  };
}
