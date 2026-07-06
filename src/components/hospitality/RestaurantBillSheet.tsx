import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Language, SaleLine, TableSession } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { ModalSheet } from "../layout/ModalSheet";
import { usePosStore } from "../../store/usePosStore";
import {
  billDraftFromSale,
  computeRestaurantBillTotals,
} from "../../lib/restaurantBilling";
import { splitRemainingUgx } from "../../lib/restaurantReceiptPrint";

type Props = {
  lang: Language;
  open: boolean;
  busy?: boolean;
  session: TableSession;
  tableLabel: string;
  areaName?: string | null;
  lines: SaleLine[];
  cartDiscountUgx: number;
  onClose: () => void;
  onSplit: () => void;
  onPreview: () => void;
  onPartialDone: () => void;
  onFinalized: () => void;
};

const PAYMENT_METHODS = ["cash", "mobile_money", "atm", "card", "voucher", "credit"] as const;

export function RestaurantBillSheet({
  lang,
  open,
  busy = false,
  session,
  tableLabel,
  areaName,
  lines,
  cartDiscountUgx,
  onClose,
  onSplit,
  onPreview,
  onPartialDone,
  onFinalized,
}: Props) {
  const preferences = usePosStore((s) => s.preferences);
  const activePendingSaleId = usePosStore((s) => s.activePendingSaleId);
  const pendingSale = usePosStore((s) =>
    activePendingSaleId ? s.sales.find((x) => x.id === activePendingSaleId) : undefined,
  );
  const updateTableBillDraft = usePosStore((s) => s.updateTableBillDraft);
  const recordTableBillPayment = usePosStore((s) => s.recordTableBillPayment);
  const finalizeTableBill = usePosStore((s) => s.finalizeTableBill);
  const printRestaurantReceiptForSale = usePosStore((s) => s.printRestaurantReceiptForSale);

  const billDraft = useMemo(
    () => billDraftFromSale(pendingSale, preferences),
    [pendingSale, preferences],
  );

  const totals = useMemo(
    () =>
      computeRestaurantBillTotals({
        lines,
        cartDiscountUgx,
        billDraft,
        prefs: preferences,
      }),
    [lines, cartDiscountUgx, billDraft, preferences],
  );

  const [payMethod, setPayMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [payAmount, setPayAmount] = useState("");
  const [reference, setReference] = useState("");
  const [serviceChargePct, setServiceChargePct] = useState(
    String(billDraft.serviceChargePercent ?? preferences.hospitalityServiceChargePercent ?? 0),
  );
  const [tipMode, setTipMode] = useState(billDraft.tipMode ?? "none");
  const [tipValue, setTipValue] = useState(
    billDraft.tipMode === "percent" ? String(billDraft.tipPercent ?? 0) : String(billDraft.tipUgx ?? 0),
  );
  const [localBusy, setLocalBusy] = useState(false);
  const [selectedSplitId, setSelectedSplitId] = useState<string | null>(null);

  const selectedSplit = billDraft.splits.find((s) => s.id === selectedSplitId) ?? null;
  const splitOwedUgx = selectedSplit ? splitRemainingUgx(selectedSplit) : totals.remainingBalanceUgx;

  const payUgx = Math.max(0, Math.floor(Number(payAmount.replace(/\D/g, "")) || 0));
  const openedAt = new Date(session.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const applyBillAdjustments = () => {
    const pct = Math.max(0, Number(serviceChargePct) || 0);
    const tipPct = tipMode === "percent" ? Math.max(0, Number(tipValue) || 0) : null;
    const tipUgx = tipMode === "fixed" || tipMode === "custom" ? Math.max(0, Math.floor(Number(tipValue) || 0)) : 0;
    updateTableBillDraft({
      serviceChargePercent: pct,
      tipMode,
      tipPercent: tipPct,
      tipUgx,
    });
  };

  const handleRecordPayment = () => {
    if (busy || localBusy) return;
    applyBillAdjustments();
    const amount = payUgx > 0 ? payUgx : splitOwedUgx;
    if (amount <= 0) return;
    setLocalBusy(true);
    const res = recordTableBillPayment({
      method: payMethod,
      amountUgx: amount,
      reference: reference.trim() || null,
      splitId: selectedSplitId,
    });
    setLocalBusy(false);
    if (!res.ok) return;
    if (selectedSplitId && activePendingSaleId) {
      const splitIdx = billDraft.splits.findIndex((s) => s.id === selectedSplitId);
      void printRestaurantReceiptForSale(activePendingSaleId, {
        tableLabel,
        waiterLabel: session.waiterLabel ?? null,
        guestCount: session.guestCount ?? null,
        splitId: selectedSplitId,
        splitLabel: selectedSplit?.label ?? null,
        splitIndex: splitIdx >= 0 ? splitIdx : null,
        receiptKind: "guest",
      });
    }
    setPayAmount("");
    setReference("");
    if (res.canFinalize) {
      handleFinalize();
      return;
    }
    onPartialDone();
  };

  const handleFinalize = () => {
    if (busy || localBusy) return;
    applyBillAdjustments();
    setLocalBusy(true);
    const res = finalizeTableBill();
    setLocalBusy(false);
    if (res.ok) onFinalized();
  };

  if (!open) return null;

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[60]"
      clearNav={false}
      maxHeightClass="max-h-[min(96dvh,900px)]"
      title={
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-black text-stone-950">{t(lang, "restaurantBillTitle")}</h2>
            <p className="mt-1 text-lg font-black text-waka-700">{tableLabel}</p>
            <p className="text-xs font-bold text-stone-500">
              {areaName ? `${areaName} · ` : ""}
              {session.guestCount} {t(lang, "tableOrderGuests")}
              {session.waiterLabel ? ` · ${session.waiterLabel}` : ""}
            </p>
            <p className="text-xs font-medium text-stone-400">
              {t(lang, "restaurantBillOpened")}: {openedAt}
            </p>
          </div>
          <button type="button" className="min-h-[44px] shrink-0 px-2 text-sm font-bold text-stone-500" onClick={onClose} disabled={busy || localBusy}>
            {t(lang, "cancel")}
          </button>
        </div>
      }
      footer={
        <div className="space-y-2">
          {totals.remainingBalanceUgx > 0 ? (
            <button
              type="button"
              disabled={busy || localBusy}
              onClick={handleRecordPayment}
              className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-waka-600 text-lg font-black text-white disabled:opacity-50"
            >
              {localBusy ? "…" : t(lang, "restaurantBillRecordPayment")}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || localBusy || totals.grandTotalUgx <= 0}
              onClick={handleFinalize}
              className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-emerald-600 text-lg font-black text-white disabled:opacity-50"
            >
              {localBusy ? "…" : t(lang, "tableSettleConfirm")}
            </button>
          )}
        </div>
      }
    >
      <section className="mb-4 rounded-2xl border border-stone-100 bg-stone-50 p-3">
        <p className="mb-2 text-xs font-black uppercase tracking-wide text-stone-500">{t(lang, "restaurantBillItems")}</p>
        <ul className="max-h-40 space-y-2 overflow-y-auto">
          {lines.map((line) => (
            <li key={line.id ?? line.productId} className="flex justify-between gap-2 text-sm font-bold text-stone-800">
              <span className="min-w-0 truncate">
                {line.name}
                {line.seatNumber ? ` · ${t(lang, "restaurantBillSeat")} ${line.seatNumber}` : ""}
              </span>
              <span className="shrink-0">
                {line.quantity} · {formatUgx(line.lineTotalUgx)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mb-4 space-y-1 rounded-2xl border border-stone-100 bg-white p-3 text-sm font-bold">
        <div className="flex justify-between text-stone-600">
          <span>{t(lang, "subtotal")}</span>
          <span>{formatUgx(totals.listSubtotalUgx)}</span>
        </div>
        {totals.lineDiscountUgx + totals.cartDiscountUgx > 0 ? (
          <div className="flex justify-between text-rose-700">
            <span>{t(lang, "discount")}</span>
            <span>-{formatUgx(totals.lineDiscountUgx + totals.cartDiscountUgx)}</span>
          </div>
        ) : null}
        {totals.serviceChargeUgx > 0 ? (
          <div className="flex justify-between text-stone-600">
            <span>
              {t(lang, "restaurantBillServiceCharge")} ({totals.serviceChargePercent}%)
            </span>
            <span>{formatUgx(totals.serviceChargeUgx)}</span>
          </div>
        ) : null}
        {totals.taxUgx > 0 ? (
          <div className="flex justify-between text-stone-600">
            <span>{t(lang, "restaurantBillTax")}</span>
            <span>{formatUgx(totals.taxUgx)}</span>
          </div>
        ) : null}
        {totals.tipUgx > 0 ? (
          <div className="flex justify-between text-stone-600">
            <span>{t(lang, "restaurantBillTip")}</span>
            <span>{formatUgx(totals.tipUgx)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-stone-100 pt-2 text-base font-black text-stone-950">
          <span>{t(lang, "grandTotal")}</span>
          <span>{formatUgx(totals.grandTotalUgx)}</span>
        </div>
        {totals.paidTotalUgx > 0 ? (
          <div className="flex justify-between text-emerald-700">
            <span>{t(lang, "restaurantBillPaid")}</span>
            <span>{formatUgx(totals.paidTotalUgx)}</span>
          </div>
        ) : null}
        <div className="flex justify-between text-lg font-black text-waka-800">
          <span>{t(lang, "restaurantBillBalance")}</span>
          <span>{formatUgx(totals.remainingBalanceUgx)}</span>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <button type="button" onClick={onSplit} className="min-h-11 rounded-xl border border-stone-200 bg-white text-xs font-black text-stone-800">
          {t(lang, "splitBillBtn")}
        </button>
        <button type="button" onClick={onPreview} className="min-h-11 rounded-xl border border-stone-200 bg-white text-xs font-black text-stone-800">
          {t(lang, "restaurantBillPreview")}
        </button>
        <button
          type="button"
          onClick={() => {
            setPayAmount(String(totals.remainingBalanceUgx || ""));
          }}
          className="min-h-11 rounded-xl border border-stone-200 bg-white text-xs font-black text-stone-800"
        >
          {t(lang, "restaurantBillPayFull")}
        </button>
      </div>

      {billDraft.splits.length > 0 ? (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-black uppercase text-stone-500">{t(lang, "restaurantBillPaySplit")}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedSplitId(null);
                setPayAmount(String(totals.remainingBalanceUgx || ""));
              }}
              className={clsx(
                "min-h-10 rounded-lg border px-3 text-xs font-black",
                !selectedSplitId ? "border-waka-500 bg-waka-50" : "border-stone-200",
              )}
            >
              {t(lang, "restaurantBillPayMaster")}
            </button>
            {billDraft.splits.map((s) => {
              const owed = splitRemainingUgx(s);
              return (
                <button
                  key={s.id ?? s.label}
                  type="button"
                  onClick={() => {
                    setSelectedSplitId(s.id ?? null);
                    setPayAmount(String(owed || ""));
                  }}
                  className={clsx(
                    "min-h-10 rounded-lg border px-3 text-xs font-black",
                    selectedSplitId === s.id ? "border-waka-500 bg-waka-50" : "border-stone-200",
                    owed <= 0 && "opacity-50",
                  )}
                  disabled={owed <= 0}
                >
                  {s.label} · {formatUgx(owed)}
                </button>
              );
            })}
          </div>
          <ul className="space-y-1 rounded-xl bg-waka-50 px-3 py-2 text-xs font-bold text-stone-700">
            {billDraft.splits.map((s) => (
              <li key={s.id ?? s.label} className="flex justify-between">
                <span>{s.label}</span>
                <span>
                  {formatUgx(s.paidUgx ?? 0)} / {formatUgx(s.amountUgx)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="mb-4 rounded-2xl border border-stone-100 p-3">
        <p className="mb-2 text-sm font-black text-stone-800">{t(lang, "restaurantBillAdjustments")}</p>
        <label className="mb-2 block">
          <span className="text-xs font-bold text-stone-600">{t(lang, "restaurantBillServiceCharge")} %</span>
          <input
            value={serviceChargePct}
            onChange={(e) => setServiceChargePct(e.target.value.replace(/[^\d.]/g, ""))}
            onBlur={applyBillAdjustments}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 px-3 text-sm font-black"
          />
        </label>
        <div className="mb-2 grid grid-cols-4 gap-1">
          {(["none", "fixed", "percent", "custom"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setTipMode(m);
                updateTableBillDraft({ tipMode: m });
              }}
              className={clsx(
                "min-h-10 rounded-lg border text-[10px] font-black sm:text-xs",
                tipMode === m ? "border-waka-500 bg-waka-50" : "border-stone-200",
              )}
            >
              {t(lang, `restaurantBillTip_${m}`)}
            </button>
          ))}
        </div>
        {tipMode !== "none" ? (
          <input
            value={tipValue}
            onChange={(e) => setTipValue(e.target.value.replace(/[^\d.]/g, ""))}
            onBlur={applyBillAdjustments}
            placeholder={tipMode === "percent" ? "%" : "UGX"}
            className="min-h-[44px] w-full rounded-xl border border-stone-200 px-3 text-sm font-black"
          />
        ) : null}
      </section>

      <section className="rounded-2xl border border-stone-100 p-3">
        <p className="mb-2 text-sm font-black text-stone-800">{t(lang, "restaurantBillPayment")}</p>
        <div className="mb-3 grid grid-cols-3 gap-1">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setPayMethod(m)}
              className={clsx(
                "min-h-10 rounded-lg border text-[10px] font-black sm:text-xs",
                payMethod === m ? "border-waka-500 bg-waka-50 text-waka-950" : "border-stone-200 text-stone-700",
              )}
            >
              {t(lang, `paymentMethod_${m}`)}
            </button>
          ))}
        </div>
        <label className="mb-2 block">
          <span className="text-xs font-bold text-stone-600">{t(lang, "restaurantBillPayAmount")}</span>
          <input
            value={payAmount}
            onChange={(e) => setPayAmount(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            placeholder={formatUgx(splitOwedUgx)}
            className="mt-1 min-h-[48px] w-full rounded-xl border border-stone-200 px-4 text-xl font-black"
          />
        </label>
        {(payMethod === "mobile_money" || payMethod === "voucher" || payMethod === "atm" || payMethod === "card") && (
          <label className="block">
            <span className="text-xs font-bold text-stone-600">{t(lang, "restaurantBillReference")}</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-200 px-3 text-sm font-bold"
            />
          </label>
        )}
        {billDraft.payments.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs font-bold text-stone-600">
            {billDraft.payments.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{t(lang, `paymentMethod_${p.method}`)}</span>
                <span>{formatUgx(p.amountUgx)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </ModalSheet>
  );
}
