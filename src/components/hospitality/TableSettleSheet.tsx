import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { formatUgx } from "../../lib/formatUgx";
import { ModalSheet } from "../layout/ModalSheet";

type PaymentMethod = "cash" | "mobile_money" | "mixed";

type Props = {
  lang: Language;
  open: boolean;
  totalUgx: number;
  busy?: boolean;
  splitBreakdown?: import("../../types").BillSplitLine[] | null;
  onClose: () => void;
  onConfirm: (input: {
    paymentMethod: "cash" | "atm" | "mobile_money" | "mixed";
    amountPaidUgx: number;
    changeGivenUgx: number;
  }) => void;
};

export function TableSettleSheet({ lang, open, totalUgx, busy = false, splitBreakdown, onClose, onConfirm }: Props) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashInput, setCashInput] = useState("");
  const [momoInput, setMomoInput] = useState("");

  const cashUgx = Math.max(0, Math.floor(Number(cashInput.replace(/\D/g, "")) || 0));
  const momoUgx = Math.max(0, Math.floor(Number(momoInput.replace(/\D/g, "")) || 0));

  const { paidUgx, changeUgx, valid } = useMemo(() => {
    if (method === "cash") {
      const paid = cashUgx;
      return { paidUgx: paid, changeUgx: Math.max(0, paid - totalUgx), valid: paid >= totalUgx };
    }
    if (method === "mobile_money") {
      return { paidUgx: totalUgx, changeUgx: 0, valid: totalUgx > 0 };
    }
    const paid = cashUgx + momoUgx;
    return { paidUgx: paid, changeUgx: 0, valid: paid >= totalUgx && momoUgx > 0 };
  }, [method, cashUgx, momoUgx, totalUgx]);

  if (!open) return null;

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[60]"
      clearNav={false}
      title={
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-stone-950">{t(lang, "tableSettleTitle")}</h2>
            <p className="mt-1 text-2xl font-black text-waka-700">{formatUgx(totalUgx)}</p>
            {splitBreakdown?.length ? (
              <ul className="mt-2 space-y-1 text-xs font-bold text-stone-600">
                {splitBreakdown.map((s) => (
                  <li key={s.label}>
                    {s.label}: {formatUgx(s.amountUgx)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            className="min-h-[44px] shrink-0 px-2 text-sm font-bold text-stone-500"
            onClick={onClose}
            disabled={busy}
          >
            {t(lang, "cancel")}
          </button>
        </div>
      }
      footer={
        <button
          type="button"
          disabled={busy || !valid || totalUgx <= 0}
          onClick={() =>
            onConfirm({
              paymentMethod: method === "mobile_money" ? "mobile_money" : method === "mixed" ? "mixed" : "cash",
              amountPaidUgx: paidUgx,
              changeGivenUgx: changeUgx,
            })
          }
          className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-waka-600 text-lg font-black text-white disabled:opacity-50"
        >
          {busy ? "…" : t(lang, "tableSettleConfirm")}
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {(["cash", "mobile_money", "mixed"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={clsx(
              "min-h-11 rounded-xl border text-xs font-black sm:text-sm",
              method === m ? "border-waka-500 bg-waka-50 text-waka-950" : "border-stone-200 bg-white text-stone-700",
            )}
          >
            {m === "cash"
              ? t(lang, "paymentMethod_cash")
              : m === "mobile_money"
                ? t(lang, "paymentMethod_mobile_money")
                : t(lang, "paymentMethod_mixed")}
          </button>
        ))}
      </div>

      {(method === "cash" || method === "mixed") && (
        <label className="mt-4 block">
          <span className="text-sm font-bold text-stone-700">{t(lang, "paymentCashLabel")}</span>
          <input
            value={cashInput}
            onChange={(e) => setCashInput(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="mt-1 min-h-[48px] w-full rounded-xl border border-stone-200 px-4 py-3 text-xl font-black"
            placeholder="0"
          />
        </label>
      )}

      {method === "mixed" && (
        <label className="mt-3 block">
          <span className="text-sm font-bold text-stone-700">{t(lang, "paymentMobileMoneyLabel")}</span>
          <input
            value={momoInput}
            onChange={(e) => setMomoInput(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="mt-1 min-h-[48px] w-full rounded-xl border border-stone-200 px-4 py-3 text-xl font-black"
            placeholder="0"
          />
        </label>
      )}

      {method === "cash" && changeUgx > 0 ? (
        <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-900">
          {t(lang, "paymentChangeDueLabel")}: {formatUgx(changeUgx)}
        </p>
      ) : null}
    </ModalSheet>
  );
}
