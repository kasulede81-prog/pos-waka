import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { CloudRecoverySnapshot } from "../../lib/cloudAuthorityAudit";

type Props = {
  lang: Language;
  cloud: CloudRecoverySnapshot;
};

function formatTs(iso: string | null, lang: Language): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(lang === "lg" ? "lg-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function OwnerCloudProtectionCard({ lang, cloud }: Props) {
  const badgeClass =
    cloud.badge === "protected"
      ? "bg-emerald-100 text-emerald-900"
      : cloud.badge === "partial"
        ? "bg-amber-100 text-amber-900"
        : "bg-rose-100 text-rose-900";

  return (
    <section className="rounded-2xl border border-border/90 bg-card p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-foreground sm:text-base">{t(lang, "cloudProtectionTitle")}</h2>
          <p className="text-[11px] font-semibold text-muted-foreground">{t(lang, "cloudProtectionSub")}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${badgeClass}`}>
          {t(lang, cloud.badgeKey)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "cloudProtectionScore")}</p>
          <p className="text-lg font-black tabular-nums text-foreground">{cloud.scorePct}%</p>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "cloudProtectionUnsynced")}</p>
          <p className="text-lg font-black tabular-nums text-foreground">{cloud.unsyncedOperations}</p>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "cloudProtectionLastSync")}</p>
          <p className="text-xs font-black text-foreground">{formatTs(cloud.lastSuccessfulSyncAt, lang)}</p>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "cloudProtectionLastSnapshot")}</p>
          <p className="text-xs font-black text-foreground">{formatTs(cloud.lastSnapshotUploadAt, lang)}</p>
        </div>
      </div>

      <p className="mt-2 text-[11px] font-semibold text-muted-foreground">
        {cloud.recoveryReady && !cloud.localOnlyRisk
          ? t(lang, "cloudProtectionProtectedHint")
          : t(lang, "cloudProtectionLocalOnlyWarning")}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to="/settings/health"
          className="inline-flex min-h-[36px] items-center rounded-xl border border-border px-3 text-xs font-black text-foreground"
        >
          {t(lang, "cloudProtectionViewHealth")} →
        </Link>
        <Link
          to="/settings/devices"
          className="inline-flex min-h-[36px] items-center rounded-xl border border-border px-3 text-xs font-black text-foreground"
        >
          {t(lang, "cloudProtectionViewDevices")} →
        </Link>
      </div>
    </section>
  );
}
