import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { EnterpriseCard } from "../../../components/enterprise/EnterpriseCard";
import { Body, Caption, SectionTitle } from "../../../components/enterprise/EnterpriseTypography";
import { VISION_HARDWARE_PACKS } from "../hardwareRecommendations";

export function VisionHardwareRecommendations({ lang }: { lang: Language }) {
  return (
    <EnterpriseCard className="space-y-4 p-4">
      <div>
        <SectionTitle>{t(lang, "visionHwTitle")}</SectionTitle>
        <Caption className="text-muted-foreground">{t(lang, "visionHwSub")}</Caption>
      </div>
      <ul className="grid gap-3 lg:grid-cols-2">
        {VISION_HARDWARE_PACKS.map((pack) => (
          <li key={pack.id} className="rounded-xl border border-border/70 p-4">
            <Body className="font-semibold">{t(lang, pack.titleKey)}</Body>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {pack.itemsKeys.map((key) => (
                <li key={key}>{t(lang, key)}</li>
              ))}
            </ul>
            <Caption className="mt-3 block text-muted-foreground">{t(lang, "visionHwRecommendedFor")}</Caption>
            <ul className="mt-1 flex flex-wrap gap-2">
              {pack.forKeys.map((key) => (
                <li
                  key={key}
                  className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                >
                  {t(lang, key)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </EnterpriseCard>
  );
}
