import { Link } from "react-router-dom";
import { Cloud, ShieldCheck } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { CloudRecoverySnapshot } from "../../lib/cloudAuthorityAudit";

type Props = {
  lang: Language;
  cloud: CloudRecoverySnapshot;
  devicesOnline: number;
  devicesTotal: number;
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

export function CommandCenterCloudCard({ lang, cloud, devicesOnline, devicesTotal }: Props) {
  const badgeClass =
    cloud.badge === "protected"
      ? "bg-emerald-100 text-emerald-900"
      : cloud.badge === "partial"
        ? "bg-amber-100 text-amber-900"
        : "bg-rose-100 text-rose-900";

  return (
    <section className="overflow-hidden rounded-3xl border border-border/90 bg-gradient-to-br from-white to-muted/80 p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
            <Cloud className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-black text-foreground sm:text-base">{t(lang, "cmdCenterCloudTitle")}</h2>
            <p className="text-[11px] font-semibold text-muted-foreground">{t(lang, "cloudProtectionSub")}</p>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${badgeClass}`}>
          {t(lang, cloud.badgeKey)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label={t(lang, "cloudProtectionScore")} value={`${cloud.scorePct}%`} highlight />
        <Metric label={t(lang, "cmdCenterCloudBackup")} value={cloud.recoveryReady ? t(lang, "cmdCenterCloudOk") : t(lang, "cmdCenterCloudPartial")} />
        <Metric label={t(lang, "cmdCenterDevicesOnline")} value={`${devicesOnline}/${devicesTotal || devicesOnline || 1}`} />
        <Metric label={t(lang, "cloudProtectionUnsynced")} value={String(cloud.unsyncedOperations)} warn={cloud.unsyncedOperations > 0} />
        <Metric label={t(lang, "cloudProtectionLastSnapshot")} value={formatTs(cloud.lastSnapshotUploadAt, lang)} small />
        <Metric label={t(lang, "cloudProtectionLastSync")} value={formatTs(cloud.lastSuccessfulSyncAt, lang)} small />
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
        {cloud.recoveryReady && !cloud.localOnlyRisk
          ? t(lang, "cloudProtectionProtectedHint")
          : t(lang, "cloudProtectionLocalOnlyWarning")}
      </p>

      <Link
        to="/settings/devices"
        className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-2xl border-2 border-border bg-card px-4 text-sm font-black text-foreground"
      >
        {t(lang, "cmdCenterManageCloud")} →
      </Link>
    </section>
  );
}

function Metric({
  label,
  value,
  highlight,
  warn,
  small,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`rounded-2xl px-2.5 py-2 ${warn ? "bg-amber-50" : highlight ? "bg-waka-50" : "bg-card ring-1 ring-border"}`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-black tabular-nums text-foreground ${small ? "text-[11px]" : "text-sm"}`}>{value}</p>
    </div>
  );
}
