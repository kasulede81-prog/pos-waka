import { useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { AttentionItem } from "../../lib/ownerCommandCenter";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { WakaButton } from "../ui/wakaPrimitives";
import { Body, Caption, MonoNumber, SectionTitle } from "../enterprise/EnterpriseTypography";
import { statusTokens } from "../../lib/statusTokens";

type Props = {
  lang: Language;
  critical: AttentionItem[];
  warnings: AttentionItem[];
  information: AttentionItem[];
  reviewedCritical: AttentionItem[];
  reviewedWarnings: AttentionItem[];
  periodLabel: string;
  onAcknowledge: (alertId: string) => void;
};

function severityTokens(severity: AttentionItem["severity"]) {
  if (severity === "critical") return statusTokens.danger;
  if (severity === "warning") return statusTokens.warning;
  return statusTokens.info;
}

function formatTs(iso: string | null | undefined, lang: Language): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(lang === "lg" ? "lg-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function AlertCard({
  lang,
  item,
  onAcknowledge,
}: {
  lang: Language;
  item: AttentionItem;
  onAcknowledge?: (id: string) => void;
}) {
  const tokens = severityTokens(item.severity);
  return (
    <article className={clsx("rounded-2xl border bg-card p-3 shadow-sm", tokens.badgeRing)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={clsx("inline-flex rounded-full px-2 py-0.5 text-xs font-black uppercase", tokens.badge, tokens.badgeRing)}>
            {item.severity === "critical"
              ? t(lang, "ownerAttentionCritical")
              : item.severity === "warning"
                ? t(lang, "ownerAttentionWarnings")
                : t(lang, "ownerAttentionInfo")}
          </span>
          <SectionTitle as="h3" className="mt-1.5 !text-sm">
            {item.titleVars ? tTemplate(lang, item.titleKey, item.titleVars) : t(lang, item.titleKey)}
          </SectionTitle>
          {item.detailKey ? (
            <Body className="mt-0.5 !text-xs text-muted-foreground">
              {item.detailVars ? tTemplate(lang, item.detailKey, item.detailVars) : t(lang, item.detailKey)}
            </Body>
          ) : null}
          {item.actorLabel ? (
            <Caption className="mt-1 block normal-case">
              {t(lang, "ownerAttentionActor")}: {item.actorLabel}
            </Caption>
          ) : null}
          {formatTs(item.timestamp, lang) ? (
            <Caption className="normal-case">{formatTs(item.timestamp, lang)}</Caption>
          ) : null}
        </div>
        {item.amountUgx != null && item.amountUgx > 0 ? (
          <MonoNumber className="shrink-0 text-sm">UGX {item.amountUgx.toLocaleString()}</MonoNumber>
        ) : null}
      </div>
      <div className="mt-3 flex gap-2">
        <Link to={item.actionTo} className="flex-1">
          <WakaButton type="button" variant="primary" className="w-full">
            {t(lang, item.actionLabelKey)}
          </WakaButton>
        </Link>
        {onAcknowledge && item.acknowledgeable !== false && item.severity !== "information" ? (
          <WakaButton type="button" variant="secondary" className="flex-1" onClick={() => onAcknowledge(item.id)}>
            {t(lang, "ownerAttentionAcknowledge")}
          </WakaButton>
        ) : null}
      </div>
    </article>
  );
}

export function CommandCenterAttentionSection({
  lang,
  critical,
  warnings,
  information,
  reviewedCritical,
  reviewedWarnings,
  periodLabel,
  onAcknowledge,
}: Props) {
  const [showReviewed, setShowReviewed] = useState(false);
  const active = [...critical, ...warnings, ...information];
  const reviewedTotal = reviewedCritical.length + reviewedWarnings.length;

  return (
    <EnterpriseCard
      title={t(lang, "cmdCenterAttentionTitle")}
      subtitle={tTemplate(lang, "ownerAttentionPeriod", { label: periodLabel })}
      actions={
        active.length > 0 ? (
          <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-black", statusTokens.danger.badge, statusTokens.danger.badgeRing)}>
            {active.length}
          </span>
        ) : null
      }
    >
      {active.length === 0 ? (
        <div className={clsx("rounded-2xl px-3 py-4", statusTokens.success.banner, statusTokens.success.badgeRing)}>
          <Body className="!text-sm font-semibold text-success-foreground">{t(lang, "ownerAttentionAllClear")}</Body>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {active.map((item) => (
            <li key={item.id}>
              <AlertCard lang={lang} item={item} onAcknowledge={onAcknowledge} />
            </li>
          ))}
        </ul>
      )}

      {reviewedTotal > 0 ? (
        <div className="mt-3 border-t border-border pt-2">
          <WakaButton type="button" variant="ghost" className="w-full justify-between" onClick={() => setShowReviewed((v) => !v)}>
            <span>{tTemplate(lang, "ownerAttentionReviewed", { count: reviewedTotal })}</span>
            <span>{showReviewed ? "−" : "+"}</span>
          </WakaButton>
          {showReviewed ? (
            <ul className="space-y-2">
              {[...reviewedCritical, ...reviewedWarnings].map((item) => (
                <li key={item.id}>
                  <AlertCard lang={lang} item={item} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </EnterpriseCard>
  );
}
