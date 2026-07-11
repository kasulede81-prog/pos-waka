import clsx from "clsx";
import type { Language, PharmacyPrescription } from "../../../types";
import { t } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { prescriptionStatusLabelKey } from "../../../lib/pharmacyPrescriptions";

type Props = {
  lang: Language;
  open: boolean;
  queue: PharmacyPrescription[];
  selectedRxId: string | null;
  onClose: () => void;
  onSelect: (rxId: string) => void;
  onNewRx?: () => void;
};

export function PharmacyPrescriptionQueueDrawer({
  lang,
  open,
  queue,
  selectedRxId,
  onClose,
  onSelect,
  onNewRx,
}: Props) {
  if (!open) return null;

  return (
    <AppModalOverlay className="z-[75] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-4">
          <h2 className="text-lg font-black text-foreground">{t(lang, "pharmacyDispenseRxQueueTitle")}</h2>
          {onNewRx ? (
            <button
              type="button"
              onClick={onNewRx}
              className="shrink-0 rounded-xl bg-teal-600 px-3 py-2 text-xs font-black text-white"
            >
              {t(lang, "pharmacyRxNew")}
            </button>
          ) : null}
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {queue.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm font-semibold text-muted-foreground">
              {t(lang, "pharmacyDispenseQueueEmpty")}
            </p>
          ) : (
            queue.map((rx) => (
              <li key={rx.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(rx.id);
                    onClose();
                  }}
                  className={clsx(
                    "mb-2 w-full rounded-2xl border-2 px-4 py-3 text-left touch-manipulation",
                    selectedRxId === rx.id ? "border-teal-400 bg-teal-50" : "border-border bg-card",
                  )}
                >
                  <p className="text-sm font-black text-foreground">{rx.prescriptionNumber}</p>
                  <p className="text-xs font-semibold text-muted-foreground">
                    {rx.patientName ?? t(lang, "pharmacyRxWalkIn")}
                  </p>
                  <p className="text-[10px] font-black uppercase text-muted-foreground">
                    {t(lang, prescriptionStatusLabelKey(rx.status))}
                    {rx.priority === "urgent" ? ` · !` : ""}
                  </p>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="shrink-0 border-t border-border p-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] w-full rounded-2xl border-2 border-border font-black text-foreground"
          >
            {t(lang, "cancel")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
