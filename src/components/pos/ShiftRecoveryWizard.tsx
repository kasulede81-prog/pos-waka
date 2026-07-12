import { useState } from "react";
import type { Language, ShiftRecord } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { shiftExpectedCashLabelParts } from "../../lib/saleAdjustments";
import { computeCashVarianceThresholdUgx } from "../../lib/cashVarianceExperience";
import { formatShiftDuration } from "../../lib/shiftEnforcement";
import { usePosStore } from "../../store/usePosStore";
import { ShiftCloseModal } from "./ShiftCloseModal";

type Props = {
  lang: Language;
  open: boolean;
  shift: ShiftRecord | null;
  recoveryMode?: boolean;
  onClose: () => void;
  onConfirm: (
    countedCashUgx: number,
    handoffFloatUgx: number | undefined,
    recoveryMeta?: { recoveryReason: string; recoveryNotes: string },
  ) => { ok: boolean; errorKey?: string };
};

export function ShiftRecoveryWizard({ lang, open, shift, recoveryMode = false, onClose, onConfirm }: Props) {
  const [step, setStep] = useState<"review" | "count">("review");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [recoveryNotes, setRecoveryNotes] = useState("");
  const preferences = usePosStore((s) => s.preferences);

  const operatorLabel = shift?.actorName ?? shift?.actorUserId ?? "—";

  if (!open || !shift) return null;

  if (step === "count") {
    return (
      <ShiftCloseModal
        lang={lang}
        open
        shift={shift}
        recoveryOperatorLabel={recoveryMode ? operatorLabel : undefined}
        onClose={() => {
          setStep("review");
          onClose();
        }}
        onConfirm={(counted, handoff) =>
          onConfirm(
            counted,
            handoff,
            recoveryMode ? { recoveryReason, recoveryNotes } : undefined,
          )
        }
      />
    );
  }

  const formulaVersion = preferences.cashDrawerFormulaVersion ?? "v1";
  const parts = shiftExpectedCashLabelParts(shift, { formulaVersion });
  const duration = formatShiftDuration(shift.startAt);

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[64]"
      clearNav={false}
      title={t(lang, "shiftRecoveryTitle")}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            disabled={recoveryMode && recoveryReason.trim().length < 3}
            onClick={() => setStep("count")}
            className="min-h-[52px] rounded-2xl bg-waka-600 font-black text-white disabled:opacity-50"
          >
            {t(lang, "shiftRecoveryContinueCount")}
          </button>
        </div>
      }
    >
      <p className="text-sm text-muted-foreground">{t(lang, "shiftRecoveryReviewHint")}</p>

      <dl className="mt-4 space-y-2 rounded-2xl bg-muted p-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="font-semibold text-muted-foreground">{t(lang, "shiftRecoveryOperator")}</dt>
          <dd className="font-black text-foreground">{operatorLabel}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-semibold text-muted-foreground">{t(lang, "openShiftsColStarted")}</dt>
          <dd className="font-semibold text-foreground">{new Date(shift.startAt).toLocaleString()}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-semibold text-muted-foreground">{t(lang, "openShiftsColDuration")}</dt>
          <dd className="font-semibold text-foreground">{duration}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-2">
          <dt className="font-semibold text-muted-foreground">{t(lang, "shiftCloseExpected")}</dt>
          <dd className="font-black text-foreground">UGX {parts.expected.toLocaleString()}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="font-semibold text-muted-foreground">{t(lang, "drawerVarianceTolerance")}</dt>
          <dd className="font-black text-foreground">
            ±UGX {computeCashVarianceThresholdUgx(parts.expected, preferences).toLocaleString()}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs font-medium text-muted-foreground">{t(lang, "drawerToleranceScopeHint")}</p>

      {recoveryMode ? (
        <>
          <label className="mt-4 block text-sm font-bold text-foreground">
            {t(lang, "shiftRecoveryReason")}
            <input
              value={recoveryReason}
              onChange={(e) => setRecoveryReason(e.target.value.slice(0, 120))}
              className="mt-2 min-h-[48px] w-full rounded-2xl border-2 border-waka-200 px-4 font-semibold outline-none ring-waka-300 focus:ring"
              placeholder={t(lang, "shiftRecoveryReasonPlaceholder")}
            />
          </label>
          <label className="mt-4 block text-sm font-bold text-foreground">
            {t(lang, "shiftRecoveryNotes")}
            <textarea
              value={recoveryNotes}
              onChange={(e) => setRecoveryNotes(e.target.value.slice(0, 500))}
              rows={3}
              className="mt-2 w-full rounded-2xl border-2 border-waka-200 px-4 py-3 font-semibold outline-none ring-waka-300 focus:ring"
              placeholder={t(lang, "shiftRecoveryNotesPlaceholder")}
            />
          </label>
        </>
      ) : null}
    </ModalSheet>
  );
}
