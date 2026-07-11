import clsx from "clsx";
import type { Language, PharmacyPrescription } from "../../../types";
import { t } from "../../../lib/i18n";
import { prescriptionStatusLabelKey } from "../../../lib/pharmacyPrescriptions";
import { printPrescriptionSummary } from "../../../lib/pharmacyPrescriptionPrint";
import type { ShopPreferences } from "../../../types";

type Props = {
  lang: Language;
  rx: PharmacyPrescription;
  preferences: ShopPreferences;
  onSubmitVerify: () => void;
  onVerify: () => void;
  onBeginDispense: () => void;
  onRefill: () => void;
};

export function PharmacyRxActionBar({
  lang,
  rx,
  preferences,
  onSubmitVerify,
  onVerify,
  onBeginDispense,
  onRefill,
}: Props) {
  const canBegin = ["verified", "ready", "dispensing"].includes(rx.status);
  const needsVerify = rx.status === "draft" || rx.status === "waiting_verification";

  return (
    <div className="shrink-0 flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-2 py-2">
      <span className="rounded-lg bg-muted px-2 py-1 text-[10px] font-black text-muted-foreground">
        {rx.prescriptionNumber} · {t(lang, prescriptionStatusLabelKey(rx.status))}
      </span>
      {needsVerify ? (
        <>
          <ActionBtn label={t(lang, "pharmacyRxSubmitVerify")} onClick={onSubmitVerify} />
          <ActionBtn label={t(lang, "pharmacyRxVerify")} onClick={onVerify} primary />
        </>
      ) : null}
      {canBegin ? (
        <ActionBtn label={t(lang, "pharmacyRxBeginDispense")} onClick={onBeginDispense} primary />
      ) : null}
      <ActionBtn
        label={t(lang, "pharmacyRxPrint")}
        onClick={() => printPrescriptionSummary(lang, rx, preferences)}
      />
      <ActionBtn label={t(lang, "pharmacyRxRefill")} onClick={onRefill} />
    </div>
  );
}

function ActionBtn({
  label,
  onClick,
  primary,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "min-h-[36px] rounded-lg px-2.5 text-[10px] font-black touch-manipulation sm:text-xs",
        primary ? "bg-teal-600 text-white" : "border border-border bg-card text-foreground",
      )}
    >
      {label}
    </button>
  );
}
