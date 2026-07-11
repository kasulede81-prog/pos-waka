import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Language, Product, SaleLine } from "../../types";
import { t } from "../../lib/i18n";
import { allocateFefo, getProductBatches, isBatchTrackedProduct, sortBatchesFefo } from "../../lib/pharmacyBatches";
import { AppModalOverlay } from "../layout/AppModalOverlay";

type Props = {
  lang: Language;
  product: Product;
  line: SaleLine;
  onConfirm: (batchId: string | null, reason: string | null) => void;
  onClose: () => void;
};

export function PharmacyFefoBatchPicker({ lang, product, line, onConfirm, onClose }: Props) {
  const batches = useMemo(() => getProductBatches(product), [product]);
  const fefoDefault = useMemo(() => allocateFefo(batches, line.quantity), [batches, line.quantity]);
  const defaultBatchId = fefoDefault.allocations[0]?.batchId ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(line.pharmacyBatchOverrideId ?? defaultBatchId);
  const [reason, setReason] = useState(line.pharmacyFefoOverrideReason ?? "");
  const [confirmOverride, setConfirmOverride] = useState(false);

  const sorted = useMemo(() => sortBatchesFefo(batches), [batches]);
  const isOverride = selectedId !== null && selectedId !== defaultBatchId;

  const apply = () => {
    if (isOverride && !reason.trim()) {
      setConfirmOverride(true);
      return;
    }
    onConfirm(isOverride ? selectedId : null, isOverride ? reason.trim() : null);
    onClose();
  };

  if (!isBatchTrackedProduct(product) || batches.length === 0) {
    return null;
  }

  return (
    <AppModalOverlay className="z-[76] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl">
        <div className="shrink-0 border-b border-border px-4 py-4">
          <h2 className="text-xl font-black text-foreground">{t(lang, "pharmacyFefoBatchTitle")}</h2>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">{line.name}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {fefoDefault.allocations[0] ? (
            <div className="mb-4 rounded-2xl border border-teal-200 bg-teal-50 p-3">
              <p className="text-xs font-black uppercase text-teal-800">{t(lang, "pharmacyFefoSelected")}</p>
              <p className="mt-1 text-base font-black text-teal-950">
                {fefoDefault.allocations[0].batchNumber} · {fefoDefault.allocations[0].expiryDate}
              </p>
            </div>
          ) : null}

          <ul className="space-y-2">
            {sorted.map((batch) => {
              const active = selectedId === batch.id;
              return (
                <li key={batch.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(batch.id)}
                    className={clsx(
                      "flex w-full min-h-[56px] flex-col items-start rounded-2xl border-2 px-4 py-3 text-left touch-manipulation",
                      active ? "border-waka-500 bg-waka-50" : "border-border bg-card",
                    )}
                  >
                    <span className="text-base font-black text-foreground">{batch.batchNumber}</span>
                    <span className="text-sm font-semibold text-muted-foreground">
                      {t(lang, "pharmacyExpiryDateLabel")}: {batch.expiryDate} · {t(lang, "pharmacyFefoRemaining")}:{" "}
                      {batch.quantityRemaining}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {isOverride ? (
            <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-black text-amber-950">{t(lang, "pharmacyFefoOverrideWarn")}</p>
              <label className="mt-2 block text-sm font-bold text-foreground">
                {t(lang, "pharmacyFefoOverrideReason")} *
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-amber-200 px-3 text-base font-semibold"
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 grid grid-cols-2 gap-2 border-t border-border p-4">
          <button type="button" onClick={onClose} className="min-h-[52px] rounded-2xl border-2 font-bold">
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              if (isOverride && !reason.trim()) {
                setConfirmOverride(true);
                return;
              }
              apply();
            }}
            className="min-h-[52px] rounded-2xl bg-waka-600 text-base font-black text-white"
          >
            {t(lang, "confirm")}
          </button>
        </div>
      </div>

      {confirmOverride && !reason.trim() ? (
        <AppModalOverlay className="z-[77] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-4 shadow-xl">
            <p className="text-sm font-bold text-foreground">{t(lang, "pharmacyFefoOverrideReasonRequired")}</p>
            <button type="button" onClick={() => setConfirmOverride(false)} className="mt-3 min-h-[44px] w-full rounded-xl border font-bold">
              {t(lang, "cancel")}
            </button>
          </div>
        </AppModalOverlay>
      ) : null}
    </AppModalOverlay>
  );
}

/** Compact batch summary chip for cart rows. */
export function PharmacyFefoBatchChip({
  lang,
  line,
  onTap,
}: {
  lang: Language;
  line: SaleLine;
  onTap?: () => void;
}) {
  if (!line.pharmacyBatchNumber) return null;
  return (
    <button
      type="button"
      onClick={onTap}
      className="mt-1 inline-flex max-w-full items-center gap-1 rounded-lg bg-teal-50 px-2 py-0.5 text-left text-[11px] font-bold text-teal-900 touch-manipulation"
    >
      <span className="truncate">
        {t(lang, "pharmacyBatchNumber")}: {line.pharmacyBatchNumber}
        {line.pharmacyBatchExpiry ? ` · ${line.pharmacyBatchExpiry}` : ""}
      </span>
      {line.pharmacyBatchOverrideId ? (
        <span className="shrink-0 rounded bg-amber-200 px-1 text-[9px] font-black uppercase text-amber-950">
          {t(lang, "pharmacyFefoOverride")}
        </span>
      ) : null}
    </button>
  );
}
