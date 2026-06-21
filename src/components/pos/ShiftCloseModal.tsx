import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Language, ShiftRecord } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { shiftExpectedCashLabelParts } from "../../lib/saleAdjustments";
import { isFormulaV2 } from "../../lib/dayDrawerOpen";
import { usePosStore } from "../../store/usePosStore";

type Props = {
  lang: Language;
  open: boolean;
  shift: ShiftRecord | null;
  onClose: () => void;
  onConfirm: (countedCashUgx: number, handoffFloatUgx?: number) => { ok: boolean; errorKey?: string };
};

export function ShiftCloseModal({ lang, open, shift, onClose, onConfirm }: Props) {
  const [counted, setCounted] = useState("");
  const [handoff, setHandoff] = useState("");
  const preferences = usePosStore((s) => s.preferences);
  const v2 = isFormulaV2(preferences);
  const formulaVersion = preferences.cashDrawerFormulaVersion ?? "v1";

  const parts = useMemo(
    () => (shift ? shiftExpectedCashLabelParts(shift, { formulaVersion }) : null),
    [shift, formulaVersion],
  );
  const countedN = Math.floor(Number(counted.replace(/\D/g, "")) || 0);
  const handoffN = Math.floor(Number(handoff.replace(/\D/g, "")) || 0);
  const expected = parts?.expected ?? 0;
  const diff = countedN - expected;

  if (!open || !shift || !parts) return null;

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[64]"
      clearNav={false}
      title={t(lang, "shiftCloseTitle")}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            disabled={(countedN <= 0 && expected > 0) || (v2 && handoffN <= 0 && countedN > 0)}
            onClick={() => {
              const r = onConfirm(countedN, v2 ? handoffN : undefined);
              if (r.ok) onClose();
            }}
            className="min-h-[52px] rounded-2xl bg-waka-600 font-black text-white disabled:opacity-50"
          >
            {t(lang, "shiftCloseConfirm")}
          </button>
        </div>
      }
    >
      <p className="text-sm text-slate-600">{t(lang, "shiftCloseHint")}</p>

      <ul className="mt-4 space-y-2 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">
        {parts.openingFloat > 0 ? (
          <li className="flex justify-between text-sky-800">
            <span>{t(lang, "shiftCloseOpeningFloat")}</span>
            <span>UGX {parts.openingFloat.toLocaleString()}</span>
          </li>
        ) : null}
        <li className="flex justify-between">
          <span>{t(lang, "shiftCloseSales")}</span>
          <span>UGX {parts.sales.toLocaleString()}</span>
        </li>
        {parts.discounts > 0 ? (
          <li className="flex justify-between text-amber-800">
            <span>{t(lang, "shiftCloseDiscounts")}</span>
            <span>− UGX {parts.discounts.toLocaleString()}</span>
          </li>
        ) : null}
        {parts.voids > 0 ? (
          <li className="flex justify-between text-rose-800">
            <span>{t(lang, "shiftCloseVoids")}</span>
            <span>− UGX {parts.voids.toLocaleString()}</span>
          </li>
        ) : null}
        {parts.returns > 0 ? (
          <li className="flex justify-between text-rose-800">
            <span>{t(lang, "shiftCloseReturns")}</span>
            <span>− UGX {parts.returns.toLocaleString()}</span>
          </li>
        ) : null}
        {parts.debtPayments > 0 ? (
          <li className="flex justify-between text-teal-800">
            <span>{t(lang, "shiftCloseDebtPayments")}</span>
            <span>+ UGX {parts.debtPayments.toLocaleString()}</span>
          </li>
        ) : null}
        <li className="flex justify-between border-t border-slate-200 pt-2 text-base font-black text-slate-900">
          <span>{t(lang, "shiftCloseExpected")}</span>
          <span>UGX {expected.toLocaleString()}</span>
        </li>
      </ul>

      <label className="mt-4 block text-sm font-bold text-slate-800">
        {t(lang, "shiftCloseCounted")}
        <input
          value={counted}
          onChange={(e) => setCounted(e.target.value.replace(/\D/g, "").slice(0, 12))}
          inputMode="numeric"
          autoFocus
          className="mt-2 min-h-[56px] w-full rounded-2xl border-2 border-waka-300 px-4 text-3xl font-black outline-none ring-waka-300 focus:ring"
        />
      </label>

      {v2 ? (
        <label className="mt-4 block text-sm font-bold text-slate-800">
          {t(lang, "shiftCloseHandoff")}
          <input
            value={handoff}
            onChange={(e) => setHandoff(e.target.value.replace(/\D/g, "").slice(0, 12))}
            inputMode="numeric"
            className="mt-2 min-h-[56px] w-full rounded-2xl border-2 border-sky-200 px-4 text-3xl font-black outline-none ring-sky-300 focus:ring"
          />
        </label>
      ) : null}

      {counted.length > 0 ? (
        <p
          className={clsx(
            "mt-3 rounded-xl px-3 py-2 text-sm font-black",
            diff === 0 ? "bg-emerald-50 text-emerald-900" : diff > 0 ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-900",
          )}
        >
          {tTemplate(lang, diff === 0 ? "shiftCloseBalanced" : diff > 0 ? "shiftCloseOver" : "shiftCloseShort", {
            amount: Math.abs(diff).toLocaleString(),
          })}
        </p>
      ) : null}
    </ModalSheet>
  );
}
