import { useMemo, useState } from "react";
import type { Language, PharmacyPrescription } from "../../../types";
import { t } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { usePosStore } from "../../../store/usePosStore";
import { verifyOwnerPin } from "../../../lib/sensitiveActionAuth";
import type { ControlledDispenseValidation, ControlledLineInfo } from "../../../lib/pharmacyControlledMedicine";
import { compliancePrefs } from "../../../lib/pharmacyControlledMedicine";
import { buildControlledComplianceApproval } from "../../../lib/pharmacyControlledCheckout";
import { useSessionActor } from "../../../context/SessionActorContext";
import { WakaCheckbox } from "../../enterprise/WakaCheckbox";

type Props = {
  lang: Language;
  open: boolean;
  validation: ControlledDispenseValidation;
  prescription: PharmacyPrescription | null;
  patientName: string | null;
  onClose: () => void;
  onApproved: () => void;
};

function scheduleLabel(lang: Language, schedule: string): string {
  const key = `pharmacyComplianceSchedule_${schedule}` as const;
  const translated = t(lang, key);
  return translated === key ? schedule : translated;
}

export function PharmacyControlledDispenseGate({
  lang,
  open,
  validation,
  prescription,
  patientName,
  onClose,
  onApproved,
}: Props) {
  const actor = useSessionActor();
  const preferences = usePosStore((s) => s.preferences);
  const setPharmacyDispenseCompliance = usePosStore((s) => s.setPharmacyDispenseCompliance);
  const logAuditAction = usePosStore((s) => s.logAuditAction);
  const prefs = compliancePrefs(preferences);
  const staff = useMemo(
    () => (preferences.staffAccounts ?? []).filter((s) => s.active && s.id !== actor.userId),
    [preferences.staffAccounts, actor.userId],
  );

  const [patientVerified, setPatientVerified] = useState(false);
  const [prescriptionVerified, setPrescriptionVerified] = useState(false);
  const [managerPin, setManagerPin] = useState("");
  const [managerReason, setManagerReason] = useState("");
  const [witnessId, setWitnessId] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const needsRxVerify = prescription != null;
  const needsManager = validation.requiresManager;
  const needsWitness = validation.requiresWitness && prefs.witnessWorkflowEnabled;

  const submit = () => {
    if (!patientVerified) {
      setError(t(lang, "pharmacyCompliancePatientVerifyRequired"));
      return;
    }
    if (needsRxVerify && !prescriptionVerified) {
      setError(t(lang, "pharmacyComplianceRxVerifyRequired"));
      return;
    }
    if (needsManager) {
      if (!managerReason.trim()) {
        setError(t(lang, "pharmacyRxControlledReasonRequired"));
        return;
      }
      if (!verifyOwnerPin(managerPin, preferences)) {
        logAuditAction("sensitive_action_auth_denied", "Controlled dispense manager PIN denied", {
          context: "controlled_dispense_gate",
          actorUserId: actor.userId,
          actorName: actor.displayName,
          actorRole: actor.role,
        });
        logAuditAction("pharmacy_manager_approval", "Controlled dispense approval denied", {
          context: "controlled_dispense_gate",
          denied: true,
        });
        setError(t(lang, "pinIncorrect"));
        return;
      }
    }
    let witnessUserId: string | null = null;
    let witnessName: string | null = null;
    if (needsWitness) {
      const witness = staff.find((s) => s.id === witnessId);
      if (!witness) {
        setError(t(lang, "pharmacyComplianceWitnessRequired"));
        return;
      }
      witnessUserId = witness.id;
      witnessName = witness.name;
    }

    setPharmacyDispenseCompliance(
      buildControlledComplianceApproval({
        patientVerified: true,
        prescriptionVerified: needsRxVerify ? prescriptionVerified : true,
        managerApproved: needsManager,
        managerReason: needsManager ? managerReason.trim() : null,
        witnessUserId,
        witnessName,
        actor,
        pinVerified: needsManager,
      }),
    );
    if (needsManager) {
      logAuditAction("pharmacy_manager_approval", "Controlled dispense manager approval granted", {
        context: "controlled_dispense_gate",
        actorUserId: actor.userId,
        actorName: actor.displayName,
        actorRole: actor.role,
      });
    }
    setPatientVerified(false);
    setPrescriptionVerified(false);
    setManagerPin("");
    setManagerReason("");
    setWitnessId("");
    setError(null);
    onApproved();
    onClose();
  };

  return (
    <AppModalOverlay className="z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
        <h2 className="text-xl font-black text-violet-950">{t(lang, "pharmacyComplianceGateTitle")}</h2>
        <p className="mt-1 text-sm font-semibold text-stone-600">{t(lang, "pharmacyComplianceGateSub")}</p>

        <div className="mt-4 rounded-2xl border-2 border-violet-200 bg-violet-50 p-3">
          <p className="text-xs font-black uppercase text-violet-800">{t(lang, "pharmacyComplianceControlledLines")}</p>
          <ul className="mt-2 space-y-2">
            {validation.controlledLines.map((line: ControlledLineInfo) => (
              <li key={line.productId} className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-stone-900">
                <span>{line.productName}</span>
                <span className="ml-2 text-violet-800">×{line.quantity}</span>
                <span className="mt-0.5 block text-xs font-semibold text-stone-500">
                  {scheduleLabel(lang, line.schedule)}
                  {line.regulatoryCategory ? ` · ${line.regulatoryCategory}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {validation.quantityViolations.length > 0 ? (
            <p className="mt-2 text-xs font-bold text-rose-700">{t(lang, "pharmacyComplianceQtyExceeded")}</p>
          ) : null}
        </div>

        {patientName ? (
          <p className="mt-3 text-sm font-bold text-stone-800">
            {t(lang, "pharmacyCompliancePatient")}: {patientName}
          </p>
        ) : null}
        {prescription ? (
          <p className="text-sm font-bold text-stone-800">
            {t(lang, "pharmacyRxNumber")}: {prescription.prescriptionNumber}
          </p>
        ) : null}

        <div className="mt-4 rounded-2xl border-2 border-stone-200 px-4 touch-manipulation">
          <WakaCheckbox
            checked={patientVerified}
            onCheckedChange={setPatientVerified}
            label={t(lang, "pharmacyCompliancePatientVerified")}
          />
        </div>

        {needsRxVerify ? (
          <div className="mt-2 rounded-2xl border-2 border-stone-200 px-4 touch-manipulation">
            <WakaCheckbox
              checked={prescriptionVerified}
              onCheckedChange={setPrescriptionVerified}
              label={t(lang, "pharmacyComplianceRxVerified")}
            />
          </div>
        ) : null}

        {needsWitness ? (
          <label className="mt-3 block text-sm font-bold text-stone-800">
            {t(lang, "pharmacyComplianceWitness")}
            <select
              value={witnessId}
              onChange={(e) => setWitnessId(e.target.value)}
              className="mt-1 min-h-[52px] w-full rounded-2xl border-2 border-violet-200 px-4 text-base font-bold"
            >
              <option value="">{t(lang, "pharmacyComplianceWitnessSelect")}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {needsManager ? (
          <>
            <label className="mt-3 block text-sm font-bold text-stone-800">
              {t(lang, "pharmacyRxControlledReason")}
              <input
                value={managerReason}
                onChange={(e) => setManagerReason(e.target.value)}
                className="mt-1 min-h-[52px] w-full rounded-2xl border-2 border-violet-200 px-4 text-base"
              />
            </label>
            <label className="mt-3 block text-sm font-bold text-stone-800">
              {t(lang, "pharmacyRxManagerPin")}
              <input
                type="password"
                inputMode="numeric"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                className="mt-1 min-h-[52px] w-full rounded-2xl border-2 border-violet-200 px-4 font-mono text-base"
              />
            </label>
          </>
        ) : null}

        {error ? <p className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} className="min-h-[56px] rounded-2xl border-2 text-base font-black">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            className="min-h-[56px] rounded-2xl bg-violet-700 text-base font-black text-white touch-manipulation"
          >
            {t(lang, "pharmacyComplianceConfirmDispense")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
