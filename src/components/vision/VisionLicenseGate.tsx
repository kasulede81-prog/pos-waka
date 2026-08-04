import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { VisionAccess } from "../../lib/vision/canUseVision";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { Body, Caption, SectionTitle } from "../enterprise/EnterpriseTypography";

export function VisionLicenseBlockedCard({
  lang,
  access,
}: {
  lang: Language;
  access: VisionAccess;
}) {
  return (
    <EnterpriseCard className="space-y-3 p-6">
      <SectionTitle>{t(lang, "visionLicTitle")}</SectionTitle>
      <Body className="text-sm">{t(lang, access.messageKey)}</Body>
      <Caption className="text-muted-foreground">{t(lang, "visionLicContactProvider")}</Caption>
      <Link to="/settings" className="text-sm font-medium text-primary underline-offset-2 hover:underline">
        {t(lang, "settings")}
      </Link>
    </EnterpriseCard>
  );
}

export function VisionLicenseStatusStrip({ lang, access }: { lang: Language; access: VisionAccess }) {
  if (access.status === "local_bypass") return null;

  const statusLabel =
    access.status === "trial"
      ? `${t(lang, "visionLicIncludedTrial")} · ${access.trialDaysRemaining ?? "—"} ${t(lang, "visionLicDaysLeft")}`
      : access.status === "included"
        ? `${t(lang, "visionLicIncludedWith")} ${access.planLabel}`
        : access.status === "subscription_expired"
          ? t(lang, "visionLicSubExpired")
          : access.planLabel;

  return (
    <EnterpriseCard className="flex flex-wrap items-center justify-between gap-2 p-3">
      <div>
        <Caption className="text-muted-foreground">{t(lang, "visionLicTitle")}</Caption>
        <Body className="text-sm font-semibold">{statusLabel}</Body>
      </div>
      <Caption className="text-muted-foreground">
        {access.maxCameras == null
          ? t(lang, "visionLicUnlimitedCams")
          : `${access.maxCameras} ${t(lang, "visionLicCameras")}`}
        {" · "}
        {access.maxDvrs == null
          ? t(lang, "visionLicUnlimitedDvrs")
          : `${access.maxDvrs} ${t(lang, "visionLicDvrs")}`}
      </Caption>
    </EnterpriseCard>
  );
}
