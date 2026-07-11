import { useMemo, useState } from "react";
import type { Language, Product } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";
import { formatMedicineFullLabel } from "../../lib/pharmacyMedicine";
import {
  BATCH_EVENT_I18N,
  computeBatchIntegrity,
  computeMedicineBatchSummary,
  formatBatchEventMeta,
  getProductBatches,
} from "../../lib/pharmacyBatches";
import { formatUgx } from "../../lib/formatUgx";
import { ExpiryStatusBadge } from "./ExpiryStatusBadge";
import { PharmacyBatchIntegrityBanner } from "./PharmacyBatchIntegrityBanner";

export type PharmacyBatchDetailAction =
  | "receive"
  | "adjust"
  | "transfer"
  | "writeoff"
  | "return"
  | "print";

type Props = {
  lang: Language;
  product: Product;
  open: boolean;
  onClose: () => void;
  onAction?: (action: PharmacyBatchDetailAction) => void;
  canReceive?: boolean;
  canAdjust?: boolean;
  canWriteOff?: boolean;
  canReturn?: boolean;
};

export function PharmacyBatchDetailSheet({
  lang,
  product,
  open,
  onClose,
  onAction,
  canReceive = true,
  canAdjust = true,
  canWriteOff = true,
  canReturn = true,
}: Props) {
  const batches = useMemo(() => getProductBatches(product), [product]);
  const summary = useMemo(() => computeMedicineBatchSummary(product), [product]);
  const integrity = useMemo(() => computeBatchIntegrity(product), [product]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"batches" | "timeline">("batches");

  const allEvents = useMemo(
    () =>
      batches
        .flatMap((b) =>
          b.timeline.map((ev) => ({
            ...ev,
            batchNumber: b.batchNumber,
            batchId: b.id,
          })),
        )
        .sort((a, b) => b.at.localeCompare(a.at)),
    [batches],
  );

  if (!open) return null;

  const actions: Array<{ id: PharmacyBatchDetailAction; label: string; show: boolean; className?: string }> = [
    { id: "receive", label: t(lang, "pharmacyQuickReceiveStock"), show: canReceive, className: "bg-teal-600 text-white" },
    { id: "adjust", label: t(lang, "pharmacyQuickAdjust"), show: canAdjust },
    { id: "transfer", label: t(lang, "pharmacyQuickTransfer"), show: canAdjust },
    { id: "writeoff", label: t(lang, "pharmacyWriteOffCta"), show: canWriteOff, className: "border-rose-300 text-rose-800" },
    { id: "return", label: t(lang, "pharmacyReturnSupplier"), show: canReturn },
    { id: "print", label: t(lang, "pharmacyQuickPrintBatch"), show: true },
  ];

  return (
    <AppModalOverlay className="z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-t-3xl bg-card shadow-2xl sm:rounded-3xl landscape:max-h-[96dvh]">
        <div className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-black text-foreground sm:text-2xl">{formatMedicineFullLabel(product)}</h2>
              {product.pharmacyMaster?.genericName ? (
                <p className="text-sm font-semibold text-muted-foreground">{product.pharmacyMaster.genericName}</p>
              ) : null}
              {product.pharmacyMaster?.manufacturer ? (
                <p className="text-xs font-medium text-muted-foreground">
                  {product.pharmacyMaster.manufacturer}
                  {product.pharmacyMaster.country ? ` · ${product.pharmacyMaster.country}` : ""}
                </p>
              ) : null}
            </div>
            <button type="button" onClick={onClose} className="min-h-[48px] rounded-xl px-3 text-sm font-black text-muted-foreground touch-manipulation">
              {t(lang, "cancel")}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <Stat label={t(lang, "stockTitle")} value={String(product.stockOnHand)} large />
            <Stat label={t(lang, "pharmacyReportBatchCount")} value={String(summary.batchCount)} />
            <Stat label={t(lang, "pharmacyNearestExpiry")} value={summary.nearestExpiry ?? "—"} />
            <Stat label={t(lang, "pharmacyReportNearExpiryValue")} value={formatUgx(summary.nearExpiryQty * (product.costPricePerUnitUgx || 0))} />
            <Stat label={t(lang, "pharmacyDashExpired")} value={String(summary.expiredQty)} />
            <Stat label={t(lang, "pharmacyReportInventoryValue")} value={formatUgx(summary.stockValueUgx)} />
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <ExpiryStatusBadge lang={lang} product={product} />
            {product.pharmacyMaster?.controlledDrug ? (
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase text-violet-900">
                {t(lang, "pharmacyControlledBadge")}
              </span>
            ) : null}
            {product.pharmacyMaster?.refrigerated ? (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black uppercase text-sky-900">
                {t(lang, "pharmacyColdBadge")}
              </span>
            ) : null}
          </div>

          <div className="mt-3">
            <PharmacyBatchIntegrityBanner lang={lang} product={product} />
          </div>

          <div className="mt-3 flex gap-2">
            <TabBtn active={tab === "batches"} onClick={() => setTab("batches")} label={t(lang, "pharmacyBatches")} />
            <TabBtn active={tab === "timeline"} onClick={() => setTab("timeline")} label={t(lang, "pharmacyBatchTimeline")} />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6">
          {tab === "batches" ? (
            batches.length === 0 ? (
              <p className="py-8 text-center text-sm font-semibold text-muted-foreground">{t(lang, "pharmacyNoBatches")}</p>
            ) : (
              <ul className="space-y-3">
                {batches.map((batch) => (
                  <li key={batch.id} className="rounded-2xl border-2 border-border bg-muted/50 p-4 touch-manipulation">
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-2 text-left"
                      onClick={() => setExpandedId(expandedId === batch.id ? null : batch.id)}
                    >
                      <div>
                        <p className="text-lg font-black text-foreground">{batch.batchNumber}</p>
                        <p className="text-sm font-semibold text-muted-foreground">
                          {batch.quantityRemaining}/{batch.quantityReceived} · {batch.expiryDate}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {batch.supplierName ?? "—"} · {formatUgx(batch.quantityRemaining * batch.unitCostUgx)}
                          {batch.location ? ` · ${batch.location}` : ""}
                        </p>
                      </div>
                      <span className="rounded-full bg-card px-2 py-1 text-[10px] font-black uppercase text-muted-foreground">
                        {batch.status}
                      </span>
                    </button>
                    {expandedId === batch.id ? (
                      <ul className="mt-3 space-y-2 border-t border-border pt-3">
                        {batch.timeline.map((ev) => (
                          <li key={ev.id} className="rounded-xl bg-card px-3 py-2 text-xs">
                            <p className="font-black text-foreground">{t(lang, BATCH_EVENT_I18N[ev.type] ?? ev.type)}</p>
                            <p className="font-semibold text-muted-foreground">
                              {ev.at.slice(0, 16).replace("T", " ")}
                              {ev.quantityDelta != null ? ` · ${ev.quantityDelta > 0 ? "+" : ""}${ev.quantityDelta}` : ""}
                            </p>
                            {formatBatchEventMeta(ev, lang) ? (
                              <p className="text-muted-foreground">{formatBatchEventMeta(ev, lang)}</p>
                            ) : null}
                            {ev.note ? <p className="text-muted-foreground">{ev.note}</p> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <ul className="space-y-2">
              {allEvents.length === 0 ? (
                <p className="py-8 text-center text-sm font-semibold text-muted-foreground">{t(lang, "pharmacyBatchTimelineEmpty")}</p>
              ) : (
                allEvents.map((ev) => (
                  <li key={ev.id} className="rounded-2xl border border-border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-foreground">
                          {t(lang, BATCH_EVENT_I18N[ev.type] ?? ev.type)} · {ev.batchNumber}
                        </p>
                        <p className="text-xs font-semibold text-muted-foreground">
                          {ev.at.slice(0, 16).replace("T", " ")}
                          {ev.quantityDelta != null ? ` · ${ev.quantityDelta > 0 ? "+" : ""}${ev.quantityDelta}` : ""}
                        </p>
                        {formatBatchEventMeta(ev, lang) ? (
                          <p className="text-xs text-muted-foreground">{formatBatchEventMeta(ev, lang)}</p>
                        ) : null}
                        {ev.note ? <p className="text-xs text-muted-foreground">{ev.note}</p> : null}
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-border p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {actions
              .filter((a) => a.show)
              .map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onAction?.(a.id)}
                  className={`min-h-[52px] rounded-2xl border-2 border-border text-sm font-black touch-manipulation active:scale-[0.98] ${a.className ?? "bg-card text-foreground"}`}
                >
                  {a.label}
                </button>
              ))}
          </div>
          {!integrity.ok && integrity.batchTracked ? (
            <p className="mt-2 text-center text-xs font-semibold text-amber-800">{t(lang, "pharmacyBatchIntegrityHint")}</p>
          ) : null}
        </div>
      </div>
    </AppModalOverlay>
  );
}

function Stat({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-2 py-2 sm:px-3 sm:py-3">
      <p className="text-[10px] font-black uppercase text-muted-foreground">{label}</p>
      <p className={`font-black text-foreground ${large ? "text-xl sm:text-2xl" : "text-sm"}`}>{value}</p>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[44px] rounded-xl px-4 text-sm font-black touch-manipulation ${
        active ? "bg-waka-600 text-white" : "bg-muted text-muted-foreground"
      }`}
    >
      {label}
    </button>
  );
}
