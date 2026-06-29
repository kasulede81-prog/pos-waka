import clsx from "clsx";
import { Check, Copy, FileText, Printer, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AuditLogEntry, Language } from "../../../types";
import { t } from "../../../lib/i18n";
import {
  auditActionLabel,
  extractAuditDetails,
  formatAuditBeforeAfter,
  formatAuditRowSummary,
} from "../../../lib/auditCenterDetails";
import { actorDisplayLabel } from "../../../lib/activityNarrative";
import { formatAuditDeviceLabel } from "../../../lib/auditDeviceLabel";
import { ModalSheet } from "../../../components/layout/ModalSheet";
import {
  buildEventTimelineSteps,
  getActivitySeverity,
  severityBadgeClass,
  severityLabelKey,
} from "../lib/activityPresentation";

type Props = {
  lang: Language;
  entry: AuditLogEntry | null;
  shopName: string;
  productById: Map<string, { name: string }>;
  customerById: Map<string, { name: string }>;
  open: boolean;
  onClose: () => void;
  onCopy: () => void;
  onShare: () => void;
  onPrint: () => void;
  onExportPdf: () => void;
};

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 border-b border-stone-100 py-3 last:border-b-0">
      <p className="w-28 shrink-0 text-[11px] font-black uppercase tracking-wide text-stone-500">{label}</p>
      <p className="min-w-0 flex-1 text-sm font-semibold text-stone-900 break-words">{value}</p>
    </div>
  );
}

export function ActivityDetailSheet({
  lang,
  entry,
  shopName,
  productById,
  customerById,
  open,
  onClose,
  onCopy,
  onShare,
  onPrint,
  onExportPdf,
}: Props) {
  const [showTechnical, setShowTechnical] = useState(false);

  useEffect(() => {
    setShowTechnical(false);
  }, [entry?.id]);

  if (!entry) return null;

  const detail = extractAuditDetails(entry, lang);
  const staff = entry.actorName?.trim() || actorDisplayLabel(entry.actorUserId, lang);
  const when = new Date(entry.at);
  const summary = formatAuditRowSummary(lang, entry, { productById, customerById });
  const { before, after } = formatAuditBeforeAfter(detail.before, detail.after);
  const deviceLabel = formatAuditDeviceLabel(detail.deviceId ?? entry.deviceId, entry.payload);
  const severity = getActivitySeverity(entry);
  const steps = buildEventTimelineSteps(lang, entry.action);
  const pl = entry.payload;
  const amount =
    typeof pl.amountUgx === "number"
      ? `UGX ${Math.round(pl.amountUgx).toLocaleString()}`
      : typeof pl.totalUgx === "number"
        ? `UGX ${Math.round(pl.totalUgx).toLocaleString()}`
        : null;
  const receiptNo = typeof pl.receiptNo === "string" ? pl.receiptNo : typeof pl.invoiceNo === "string" ? pl.invoiceNo : null;

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      align="bottom"
      maxHeightClass="max-h-[min(94dvh,820px)]"
      title={t(lang, "icActivityDetails")}
      footer={
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onCopy} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border-2 border-stone-200 text-sm font-black text-stone-800">
              <Copy className="h-4 w-4" aria-hidden />
              {t(lang, "icCopyDetails")}
            </button>
            <button type="button" onClick={onShare} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border-2 border-stone-200 text-sm font-black text-stone-800">
              <Share2 className="h-4 w-4" aria-hidden />
              {t(lang, "icShare")}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onPrint} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border-2 border-stone-200 text-sm font-black text-stone-800">
              <Printer className="h-4 w-4" aria-hidden />
              {t(lang, "icPrint")}
            </button>
            <button type="button" onClick={onExportPdf} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-waka-600 text-sm font-black text-white">
              <FileText className="h-4 w-4" aria-hidden />
              {t(lang, "icExportThisLog")}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-black text-stone-950">{auditActionLabel(lang, entry.action)}</h3>
              <p className="mt-1 text-sm font-medium text-stone-600">{summary}</p>
            </div>
            <span className={clsx("inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase ring-1 ring-inset", severityBadgeClass(severity))}>
              {t(lang, severityLabelKey(severity))}
            </span>
          </div>
          <p className="mt-3 text-xs font-semibold text-stone-500">
            {when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>

        {(before || after) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {before ? (
              <div className="rounded-2xl border border-stone-200 bg-white p-3">
                <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "auditExportColBefore")}</p>
                <p className="mt-1 text-sm font-black text-stone-900">{before}</p>
              </div>
            ) : null}
            {after ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
                <p className="text-[10px] font-black uppercase tracking-wide text-emerald-700">{t(lang, "auditExportColAfter")}</p>
                <p className="mt-1 text-sm font-black text-emerald-950">{after}</p>
              </div>
            ) : null}
          </div>
        )}

        <div className="rounded-2xl border border-stone-200 bg-white px-4">
          <DetailRow label={t(lang, "auditColWho")} value={staff} />
          <DetailRow label={t(lang, "auditColRole")} value={entry.role} />
          <DetailRow label={t(lang, "icShop")} value={shopName} />
          <DetailRow label={t(lang, "icModule")} value={detail.entityType ?? entry.action.split("_")[0]} />
          <DetailRow label={t(lang, "auditColSummary")} value={summary} />
          <DetailRow label={t(lang, "icAmount")} value={amount} />
          <DetailRow label={t(lang, "icReceiptNo")} value={receiptNo} />
          <DetailRow label={t(lang, "auditColDevice")} value={deviceLabel} />
          <DetailRow label={t(lang, "icReferenceId")} value={entry.id} />
          <DetailRow label={t(lang, "auditExportColReason")} value={detail.reason} />
          <DetailRow label={t(lang, "icSyncStatus")} value={t(lang, "icSyncSynced")} />
        </div>

        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-widest text-stone-500">{t(lang, "icEventTimeline")}</p>
          <ol className="space-y-2">
            {steps.map((step, index) => (
              <li key={step} className="flex items-center gap-3">
                <span
                  className={clsx(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black",
                    index === steps.length - 1 ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-600",
                  )}
                >
                  {index === steps.length - 1 ? <Check className="h-4 w-4" aria-hidden /> : index + 1}
                </span>
                <span className="text-sm font-semibold text-stone-800">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-slate-50/80">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-black uppercase tracking-wide text-slate-600"
            onClick={() => setShowTechnical((v) => !v)}
            aria-expanded={showTechnical}
          >
            {t(lang, "auditTechnicalDetails")}
            <span aria-hidden>{showTechnical ? "−" : "+"}</span>
          </button>
          {showTechnical ? (
            <pre className="max-h-64 overflow-auto border-t border-slate-200 px-3 py-2 text-xs font-mono text-slate-800">
              {detail.payloadJson}
            </pre>
          ) : null}
        </div>
      </div>
    </ModalSheet>
  );
}
