import { useMemo, useState } from "react";
import type { Language, ShiftRecord } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { shiftExpectedCashLabelParts } from "../../lib/saleAdjustments";
import { isFormulaV2 } from "../../lib/dayDrawerOpen";
import { usePosStore } from "../../store/usePosStore";
import { CashVarianceSummary } from "../cash/CashVarianceSummary";

type Props = {
  lang: Language;
  open: boolean;
  shift: ShiftRecord | null;
  recoveryOperatorLabel?: string;
  onClose: () => void;
  onConfirm: (countedCashUgx: number, handoffFloatUgx?: number) => { ok: boolean; errorKey?: string };
};

export function ShiftCloseModal({ lang, open, shift, recoveryOperatorLabel, onClose, onConfirm }: Props) {
  const [counted, setCounted] = useState("");
  const [handoff, setHandoff] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
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
  const varianceContext = recoveryOperatorLabel ? "shift_recovery" : "shift_close";

  if (!open || !shift || !parts) return null;

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[64]"
      clearNav={false}
      title={recoveryOperatorLabel ? t(lang, "shiftRecoveryCountTitle") : t(lang, "shiftCloseTitle")}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            disabled={(countedN <= 0 && expected > 0) || (v2 && handoffN <= 0 && countedN > 0)}
            onClick={() => {
              setErrorKey(null);
              const r = onConfirm(countedN, v2 ? handoffN : undefined);
              if (r.ok) {
                onClose();
                return;
              }
              setErrorKey(r.errorKey ?? "drawerVarianceCloseFailed");
            }}
            className="min-h-[52px] rounded-2xl bg-waka-600 font-black text-white disabled:opacity-50"
          >
            {t(lang, "shiftCloseConfirm")}
          </button>
        </div>
      }
    >
      {recoveryOperatorLabel ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
          {tTemplate(lang, "shiftRecoveryOtherOperatorHint", { operator: recoveryOperatorLabel })}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t(lang, "shiftCloseHint")}</p>
      )}

      <ul className="mt-4 space-y-2 rounded-2xl bg-muted p-4 text-sm font-semibold text-muted-foreground">
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
        <li className="flex justify-between border-t border-border pt-2 text-base font-black text-foreground">
          <span>{t(lang, "shiftCloseExpected")}</span>
          <span>UGX {expected.toLocaleString()}</span>
        </li>
      </ul>

      <label className="mt-4 block text-sm font-bold text-foreground">
        {t(lang, "shiftCloseCounted")}
        <input
          value={counted}
          onChange={(e) => {
            setCounted(e.target.value.replace(/\D/g, "").slice(0, 12));
            setErrorKey(null);
          }}
          inputMode="numeric"
          className="mt-2 min-h-[56px] w-full rounded-2xl border-2 border-waka-300 px-4 text-3xl font-black outline-none ring-waka-300 focus:ring"
        />
      </label>

      {v2 ? (
        <label className="mt-4 block text-sm font-bold text-foreground">
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
        <CashVarianceSummary
          lang={lang}
          expectedCashUgx={expected}
          countedCashUgx={countedN}
          preferences={preferences}
          context={varianceContext}
          showSettingsLink
          diagnosticEvent="shift_close_preview"
          className="mt-4"
        />
      ) : null}

      {errorKey ? (
        <p className="mt-3 rounded-xl border border-danger/30 bg-danger-muted px-3 py-2 text-sm font-bold text-danger-foreground" role="alert">
          {t(lang, errorKey as never)}
        </p>
      ) : null}
    </ModalSheet>
  );
}
