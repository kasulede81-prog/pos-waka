import { Link } from "react-router-dom";
import { Cloud, ShieldCheck } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { CloudRecoverySnapshot } from "../../lib/cloudAuthorityAudit";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { EnterpriseKpiCard } from "../enterprise/EnterpriseKpiCard";
import { Caption } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";
import { statusTokens } from "../../lib/statusTokens";
import clsx from "clsx";

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

function badgeTone(badge: CloudRecoverySnapshot["badge"]): "success" | "warning" | "danger" {
  if (badge === "protected") return "success";
  if (badge === "partial") return "warning";
  return "danger";
}

export function CommandCenterCloudCard({ lang, cloud, devicesOnline, devicesTotal }: Props) {
  const tone = badgeTone(cloud.badge);

  return (
    <EnterpriseCard
      title={t(lang, "cmdCenterCloudTitle")}
      subtitle={t(lang, "cloudProtectionSub")}
      actions={
        <span className={clsx("rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase", statusTokens[tone].badge)}>
          {t(lang, cloud.badgeKey)}
        </span>
      }
      className="overflow-hidden bg-gradient-to-br from-card to-muted/80"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className={clsx("flex h-10 w-10 items-center justify-center rounded-2xl", statusTokens.info.icon, statusTokens.info.badge)}>
          <Cloud className="h-5 w-5" aria-hidden />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <EnterpriseKpiCard icon={ShieldCheck} label={t(lang, "cloudProtectionScore")} value={`${cloud.scorePct}%`} tone="highlight" />
        <EnterpriseKpiCard
          icon={Cloud}
          label={t(lang, "cmdCenterCloudBackup")}
          value={cloud.recoveryReady ? t(lang, "cmdCenterCloudOk") : t(lang, "cmdCenterCloudPartial")}
          tone={cloud.recoveryReady ? "success" : "warning"}
        />
        <EnterpriseKpiCard icon={Cloud} label={t(lang, "cmdCenterDevicesOnline")} value={`${devicesOnline}/${devicesTotal || devicesOnline || 1}`} />
        <EnterpriseKpiCard
          icon={Cloud}
          label={t(lang, "cloudProtectionUnsynced")}
          value={String(cloud.unsyncedOperations)}
          tone={cloud.unsyncedOperations > 0 ? "warning" : "default"}
        />
        <EnterpriseKpiCard icon={Cloud} label={t(lang, "cloudProtectionLastSnapshot")} value={formatTs(cloud.lastSnapshotUploadAt, lang)} />
        <EnterpriseKpiCard icon={Cloud} label={t(lang, "cloudProtectionLastSync")} value={formatTs(cloud.lastSuccessfulSyncAt, lang)} />
      </div>

      <Caption className="mt-3 flex items-start gap-1.5 normal-case">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
        {cloud.recoveryReady && !cloud.localOnlyRisk
          ? t(lang, "cloudProtectionProtectedHint")
          : t(lang, "cloudProtectionLocalOnlyWarning")}
      </Caption>

      <Link to="/settings/devices" className="mt-4 block">
        <WakaButton type="button" variant="secondary" className="w-full">
          {t(lang, "cmdCenterManageCloud")} →
        </WakaButton>
      </Link>
    </EnterpriseCard>
  );
}
