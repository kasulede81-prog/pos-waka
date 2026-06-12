import type { AuditLogEntry, Language } from "../../types";
import { t } from "../../lib/i18n";
import { auditActionLabel, extractAuditDetails } from "../../lib/auditCenterDetails";
import { actorDisplayLabel } from "../../lib/activityNarrative";
import { AppModalOverlay } from "../layout/AppModalOverlay";

type Props = {
  lang: Language;
  entry: AuditLogEntry | null;
  onClose: () => void;
};

export function AuditDetailDrawer({ lang, entry, onClose }: Props) {
  if (!entry) return null;

  const detail = extractAuditDetails(entry);
  const staff = entry.actorName?.trim() || actorDisplayLabel(entry.actorUserId, lang);
  const when = new Date(entry.at).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const row = (label: string, value: string | null) =>
    value ? (
      <div className="rounded-xl bg-slate-50 px-3 py-2">
        <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900 break-words">{value}</p>
      </div>
    ) : null;

  return (
    <AppModalOverlay className="z-[70] flex justify-end bg-black/40 p-0" role="dialog" aria-modal onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-black text-slate-900">{t(lang, "auditDetailTitle")}</h2>
          <button type="button" className="rounded-xl px-3 py-2 text-sm font-bold text-slate-600" onClick={onClose}>
            {t(lang, "cancel")}
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {row(t(lang, "auditColWho"), staff)}
          {row(t(lang, "auditColWhen"), when)}
          {row(t(lang, "auditColAction"), auditActionLabel(lang, entry.action))}
          {row(t(lang, "auditColRole"), entry.role)}
          {row(t(lang, "auditColDevice"), detail.deviceId ?? entry.deviceId ?? null)}
          {row(t(lang, "auditColSummary"), entry.payloadSummary)}
          {row(t(lang, "auditExportColBefore"), detail.before)}
          {row(t(lang, "auditExportColAfter"), detail.after)}
          {row(t(lang, "auditExportColReason"), detail.reason)}
          {detail.entityLabel
            ? row(
                t(lang, "auditColEntity"),
                detail.entityType ? `${detail.entityType}: ${detail.entityLabel}` : detail.entityLabel,
              )
            : null}
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{t(lang, "auditColPayload")}</p>
            <pre className="mt-2 max-h-64 overflow-auto text-xs font-mono text-slate-800">{detail.payloadJson}</pre>
          </div>
        </div>
      </div>
    </AppModalOverlay>
  );
}
