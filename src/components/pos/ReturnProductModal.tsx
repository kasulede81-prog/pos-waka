import { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import type { Language, Product, ReturnReason, ReturnRecord, Sale, UserRole } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { formatSaleLineQuantity } from "../../lib/saleQuantityLabel";
import { canPerformUnlinkedReturn } from "../../lib/returnPolicy";
import {
  remainingRefundableAmount,
  remainingRefundableForLineQty,
  remainingReturnableQuantity,
  suggestReturnRefundUgx,
} from "../../lib/returnLimits";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { PosScreenPortal } from "../layout/PosScreenPortal";
import { resolveReturnRefundUgx } from "../../lib/returnRefundInput";
import { pricePerBaseUnitUgx } from "../../lib/sellingEngine";
import { buildLineRefundBreakdown } from "../../lib/refundBreakdown";
import { RefundBreakdownPanel } from "../returns/RefundBreakdownPanel";
import { RefundReturnSummaryCard } from "../returns/RefundReturnSummaryCard";

const REASONS: ReturnReason[] = ["damaged", "warm_bad", "broken", "wrong_item", "other"];

type Props = {
  lang: Language;
  open: boolean;
  sale: Sale | null;
  products: Product[];
  returnRecords?: ReturnRecord[];
  actorRole: UserRole;
  onClose: () => void;
  onConfirm: (input: {
    saleId: string | null;
    productId: string;
    quantity: number;
    refundAmountUgx: number;
    reason: ReturnReason;
    note: string;
  }) => { ok: boolean; errorKey?: string };
};

export function ReturnProductModal({ lang, open, sale, products, returnRecords = [], actorRole, onClose, onConfirm }: Props) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [refund, setRefund] = useState("");
  const [reason, setReason] = useState<ReturnReason>("damaged");
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showCalcDetails, setShowCalcDetails] = useState(false);

  const allowUnlinked = canPerformUnlinkedReturn(actorRole);
  const lineOptions = sale?.lines.filter((l) => !l.voided) ?? [];
  const pickList = lineOptions.length
    ? lineOptions.map((l) => ({ id: l.productId, name: l.name }))
    : allowUnlinked
      ? products.map((p) => ({ id: p.id, name: p.name }))
      : [];

  useEffect(() => {
    if (!open) return;
    setProductId(pickList[0]?.id ?? "");
    setQty("1");
    setRefund("");
    setReason("damaged");
    setNote("");
    setSubmitError(null);
    setShowCalcDetails(false);
  }, [open, sale?.id, pickList.length, pickList[0]?.id]);

  const product = products.find((p) => p.id === productId) ?? null;
  const saleLine = sale?.lines.find((l) => l.productId === productId && !l.voided);
  const qtyN = Math.max(0, Number(qty.replace(/[^\d.]/g, "")) || 0);
  const suggestedRefund =
    sale && productId && qtyN > 0
      ? suggestReturnRefundUgx(sale, productId, qtyN, returnRecords)
      : product
        ? Math.round(pricePerBaseUnitUgx(product) * qtyN)
        : 0;

  const maxQty =
    sale && productId ? remainingReturnableQuantity(sale, productId, returnRecords) : null;
  const maxRefundSale = sale ? remainingRefundableAmount(sale) : null;
  const maxRefundLine =
    sale && productId && qtyN > 0
      ? remainingRefundableForLineQty(sale, productId, qtyN, returnRecords)
      : null;
  const maxRefundUgx =
    maxRefundSale != null ? Math.min(maxRefundSale, maxRefundLine ?? maxRefundSale) : null;

  const qtyUnitHint =
    product?.pharmacyPackaging?.enabled
      ? product.pharmacyPackaging.baseUnit || product.baseUnit
      : product?.baseUnit ?? null;
  const soldAsHint =
    saleLine && product
      ? formatSaleLineQuantity(saleLine, product, "short")
      : null;

  if (!open) return null;

  const parsedRefund = Math.floor(Number(refund.replace(/\D/g, "")) || 0);
  const enteredRefundUgx = parsedRefund <= 0 ? null : parsedRefund;
  const { refundUgx: finalRefundUgx } = resolveReturnRefundUgx({
    refundInput: refund,
    suggestedRefundUgx: suggestedRefund,
    maxRefundUgx,
  });
  const exceedsMax = maxRefundUgx != null && parsedRefund > 0 && parsedRefund > maxRefundUgx;
  const customAmount =
    enteredRefundUgx != null && enteredRefundUgx !== suggestedRefund && !exceedsMax;
  const qtyInvalid = maxQty != null && qtyN > maxQty;
  const canSubmit =
    !!productId &&
    qtyN > 0 &&
    !qtyInvalid &&
    !exceedsMax &&
    finalRefundUgx > 0 &&
    (sale != null || (allowUnlinked && note.trim().length >= 3));

  const refundBreakdown =
    sale && productId && qtyN > 0 && !qtyInvalid
      ? buildLineRefundBreakdown({
          sale,
          productId,
          returnQty: qtyN,
          returnRecords,
          finalRefundUgx: finalRefundUgx,
          product: product ?? undefined,
        })
      : null;

  const customerPaidUgx = refundBreakdown?.customerPaidUgx ?? suggestedRefund;
  const remainingAfterRefundUgx =
    sale != null ? Math.max(0, sale.totalUgx - finalRefundUgx) : 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setSubmitError(null);
    const r = onConfirm({
      saleId: sale?.id ?? null,
      productId,
      quantity: qtyN,
      refundAmountUgx: finalRefundUgx,
      reason,
      note: note.trim(),
    });
    if (r.ok) {
      onClose();
      return;
    }
    const key = r.errorKey;
    setSubmitError(
      key ? t(lang, key as Parameters<typeof t>[1]) : t(lang, "returnSubmitError"),
    );
  };

  const refundInputClass = clsx(
    "mt-2 min-h-[52px] w-full rounded-2xl border-2 px-4 text-xl font-black outline-none transition",
    "border-stone-400 bg-white text-stone-900 caret-amber-600",
    "placeholder:text-stone-400 placeholder:font-bold",
    "focus:border-amber-500 focus:ring-2 focus:ring-amber-200",
    exceedsMax && "border-rose-400 focus:border-rose-500 focus:ring-rose-100",
  );

  return (
    <PosScreenPortal>
      <AppModalOverlay
        clearNav={false}
        className="z-[var(--waka-z-pos-modal)] flex items-end justify-center bg-black/55 pb-[env(safe-area-inset-bottom,0px)] sm:items-center"
        role="dialog"
        aria-modal
        onClick={onClose}
      >
        <div
          className="flex max-h-[min(92vh,720px)] w-full max-w-md flex-col rounded-t-[1.75rem] bg-white shadow-2xl sm:rounded-3xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-3">
            <h2 className="text-xl font-black text-stone-900">{t(lang, "returnTitle")}</h2>
            <p className="mt-1 text-sm text-stone-600">{t(lang, "returnHint")}</p>

            <label className="mt-4 block text-sm font-bold text-stone-800">
              {t(lang, "returnProductLabel")}
              <select
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                  setRefund("");
                  setSubmitError(null);
                  setShowCalcDetails(false);
                }}
                className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-3 text-base font-bold"
              >
                {pickList.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block text-sm font-bold text-stone-800">
              {t(lang, "returnQtyLabel")}
              {qtyUnitHint ? (
                <span className="ml-1 text-xs font-semibold text-stone-500">
                  ({tTemplate(lang, "returnQtyUnitHint", { unit: qtyUnitHint })})
                </span>
              ) : null}
              <input
                value={qty}
                onChange={(e) => {
                  setQty(e.target.value.replace(/[^\d.]/g, "").slice(0, 8));
                  setSubmitError(null);
                }}
                inputMode="decimal"
                className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-stone-200 px-4 text-xl font-black"
              />
              {maxQty != null ? (
                <span className="mt-1 block text-xs font-semibold text-stone-500">
                  {tTemplate(lang, "returnMaxQtyHint", { qty: String(maxQty) })}
                  {soldAsHint ? ` · ${tTemplate(lang, "returnSoldAsHint", { qty: soldAsHint })}` : ""}
                </span>
              ) : null}
              {qtyInvalid ? (
                <span className="mt-1 block text-xs font-bold text-rose-700">
                  {tTemplate(lang, "returnMaxQtyHint", { qty: String(maxQty) })}
                </span>
              ) : null}
            </label>

            {sale && refundBreakdown ? (
              <section className="mt-4 rounded-2xl border border-waka-200 bg-waka-50/50 p-3">
                <h3 className="text-sm font-black text-stone-900">{t(lang, "returnRefundCustomerTitle")}</h3>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="font-semibold text-stone-700">{t(lang, "refundBreakdownCustomerPaid")}</dt>
                    <dd className="font-black text-stone-900">UGX {customerPaidUgx.toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="font-semibold text-stone-700">{t(lang, "returnRecommendedRefund")}</dt>
                    <dd className="font-black text-waka-900">UGX {suggestedRefund.toLocaleString()}</dd>
                  </div>
                </dl>

                <label className="mt-3 block text-sm font-bold text-stone-800">
                  {t(lang, "returnRefundAmountLabel")}
                  <input
                    value={refund}
                    onChange={(e) => {
                      setRefund(e.target.value.replace(/\D/g, "").slice(0, 10));
                      setSubmitError(null);
                    }}
                    inputMode="numeric"
                    placeholder={suggestedRefund > 0 ? String(suggestedRefund) : undefined}
                    className={refundInputClass}
                    aria-describedby="return-refund-hint"
                  />
                  <span id="return-refund-hint" className="mt-1 block text-xs font-semibold text-stone-600">
                    {t(lang, "returnRefundLeaveUnchangedHint")}
                  </span>
                  {maxRefundUgx != null ? (
                    <span className="mt-1 block text-xs font-semibold text-stone-500">
                      {tTemplate(lang, "returnMaxRefundHint", { amount: maxRefundUgx.toLocaleString() })}
                    </span>
                  ) : null}
                </label>

                {exceedsMax ? (
                  <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
                    {tTemplate(lang, "returnCapWarning", { max: (maxRefundUgx ?? 0).toLocaleString() })}
                  </p>
                ) : null}

                <RefundReturnSummaryCard
                  lang={lang}
                  customerPaidUgx={customerPaidUgx}
                  refundingUgx={finalRefundUgx}
                  remainingAfterUgx={remainingAfterRefundUgx}
                  customRefund={customAmount}
                  recommendedUgx={suggestedRefund}
                />

                <button
                  type="button"
                  onClick={() => setShowCalcDetails((v) => !v)}
                  className="mt-3 flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-black text-stone-700"
                  aria-expanded={showCalcDetails}
                >
                  {t(lang, "returnShowCalcDetails")}
                  <ChevronDown
                    className={clsx("h-4 w-4 transition", showCalcDetails && "rotate-180")}
                    aria-hidden
                  />
                </button>
                {showCalcDetails && refundBreakdown ? (
                  <RefundBreakdownPanel lang={lang} breakdown={refundBreakdown} detailsOnly compact />
                ) : null}
              </section>
            ) : (
              <label className="mt-3 block text-sm font-bold text-stone-800">
                {t(lang, "returnRefundLabel")}
                <input
                  value={refund}
                  onChange={(e) => {
                    setRefund(e.target.value.replace(/\D/g, "").slice(0, 10));
                    setSubmitError(null);
                  }}
                  inputMode="numeric"
                  placeholder={suggestedRefund > 0 ? String(suggestedRefund) : undefined}
                  className={refundInputClass}
                />
              </label>
            )}

            <p className="mt-4 text-sm font-bold text-stone-800">{t(lang, "returnReasonLabel")}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={clsx(
                    "min-h-[44px] rounded-2xl border-2 px-2 text-left text-xs font-black leading-tight sm:text-sm",
                    reason === r ? "border-amber-500 bg-amber-50 text-amber-950" : "border-stone-200",
                    r === "other" && "col-span-2",
                  )}
                >
                  {t(lang, `returnReason_${r}`)}
                </button>
              ))}
            </div>

            <label className="mt-3 block text-sm font-bold text-stone-800">
              {!sale && allowUnlinked ? t(lang, "returnUnlinkedNoteRequired") : t(lang, "voidNoteOptional")}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-2 min-h-[44px] w-full rounded-xl border-2 px-3"
                required={!sale && allowUnlinked}
              />
            </label>
            {!sale && !allowUnlinked ? (
              <p className="mt-2 text-sm font-bold text-red-800">{t(lang, "returnUnlinkedForbidden")}</p>
            ) : null}

            {submitError ? (
              <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-800">
                {submitError}
              </p>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-stone-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 font-bold">
                {t(lang, "cancel")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="min-h-[52px] rounded-2xl bg-amber-600 font-black text-white disabled:opacity-40"
              >
                {t(lang, "returnConfirm")}
              </button>
            </div>
          </div>
        </div>
      </AppModalOverlay>
    </PosScreenPortal>
  );
}
