import clsx from "clsx";
import { MoreVertical } from "lucide-react";
import type { AuditLogEntry, Language } from "../../../types";
import { auditActionLabel, formatAuditRowSummary } from "../../../lib/auditCenterDetails";
import { actorDisplayLabel } from "../../../lib/activityNarrative";
import { t } from "../../../lib/i18n";
import {
  getActivitySeverity,
  severityBadgeClass,
  severityIconClass,
  severityLabelKey,
} from "../lib/activityPresentation";

type Props = {
  lang: Language;
  entry: AuditLogEntry;
  productById: Map<string, { name: string }>;
  customerById: Map<string, { name: string }>;
  showTimelineRail?: boolean;
  isLastInGroup?: boolean;
  titleOverride?: string | null;
  subtitleOverride?: string | null;
  onOpen: () => void;
  onMenu: () => void;
};

export function ActivityTimelineCard({
  lang,
  entry,
  productById,
  customerById,
  showTimelineRail = true,
  isLastInGroup = false,
  titleOverride,
  subtitleOverride,
  onOpen,
  onMenu,
}: Props) {
  const severity = getActivitySeverity(entry);
  const staff = entry.actorName?.trim() || actorDisplayLabel(entry.actorUserId, lang);
  const when = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const narrative = subtitleOverride ?? formatAuditRowSummary(lang, entry, { productById, customerById });
  const title = titleOverride ?? auditActionLabel(lang, entry.action);

  return (
    <div className="relative flex gap-3 pl-1">
      {showTimelineRail ? (
        <div className="relative flex w-8 shrink-0 flex-col items-center">
          <div className={clsx("flex h-9 w-9 items-center justify-center rounded-full", severityIconClass(severity))}>
            <span className="h-2 w-2 rounded-full bg-current opacity-80" aria-hidden />
          </div>
          {!isLastInGroup ? <div className="mt-1 w-px flex-1 bg-muted" aria-hidden /> : null}
        </div>
      ) : null}

      <article className="mb-2 min-w-0 flex-1 rounded-2xl border border-border/90 bg-card p-3 shadow-sm">
        <div className="flex items-start gap-2">
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left active:opacity-80">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-black text-foreground">{title}</h3>
              <span
                className={clsx(
                  "inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ring-1 ring-inset",
                  severityBadgeClass(severity),
                )}
              >
                {t(lang, severityLabelKey(severity))}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs font-medium text-muted-foreground">{narrative}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-muted-foreground">
              <span>{staff}</span>
              <span aria-hidden>·</span>
              <time dateTime={entry.at}>{when}</time>
            </div>
          </button>
          <button
            type="button"
            onClick={onMenu}
            className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-xl text-muted-foreground active:bg-muted"
            aria-label={t(lang, "icActionsTitle")}
          >
            <MoreVertical className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </article>
    </div>
  );
}
