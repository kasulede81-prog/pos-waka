import { HardDrive, Network, Settings2, Star } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { EnterpriseCard } from "../../../components/enterprise/EnterpriseCard";
import { Body, Caption, SectionTitle } from "../../../components/enterprise/EnterpriseTypography";

export type VisionSourceChoice = "nvr" | "scan" | "manual";

export function VisionSourceWizard({
  lang,
  onChoose,
}: {
  lang: Language;
  onChoose: (choice: VisionSourceChoice) => void;
}) {
  const options: Array<{
    id: VisionSourceChoice;
    icon: typeof HardDrive;
    titleKey: string;
    bodyKey: string;
    badgeKey?: string;
    recommended?: boolean;
  }> = [
    {
      id: "nvr",
      icon: HardDrive,
      titleKey: "visionSourceDvrTitle",
      bodyKey: "visionSourceDvrBody",
      badgeKey: "visionSourceRecommendedStrong",
      recommended: true,
    },
    {
      id: "scan",
      icon: Network,
      titleKey: "visionSourceIpNvrTitle",
      bodyKey: "visionSourceIpNvrBody",
      badgeKey: "visionSourceProfessional",
    },
    {
      id: "manual",
      icon: Settings2,
      titleKey: "visionSourceRtspTitle",
      bodyKey: "visionSourceRtspBody",
      badgeKey: "visionSourceAdvanced",
    },
  ];

  return (
    <EnterpriseCard className="space-y-4 p-4 sm:p-6">
      <div>
        <SectionTitle>{t(lang, "visionSourceWizardTitle")}</SectionTitle>
        <Body className="mt-1 text-sm text-muted-foreground">{t(lang, "visionSourceWizardSub")}</Body>
        <Caption className="mt-2 block text-muted-foreground">{t(lang, "visionSourceAnalogHelper")}</Caption>
      </div>
      <ul className="grid gap-3 lg:grid-cols-3">
        {options.map((opt) => {
          const Icon = opt.icon;
          return (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => onChoose(opt.id)}
                className={`flex h-full w-full flex-col gap-3 rounded-xl border px-4 py-4 text-left transition hover:bg-muted/40 ${
                  opt.recommended ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                  {opt.badgeKey ? (
                    <Caption
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        opt.recommended
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {opt.recommended ? (
                        <>
                          <Star className="h-3 w-3" aria-hidden />
                          <Star className="h-3 w-3" aria-hidden />
                        </>
                      ) : null}
                      {t(lang, opt.badgeKey)}
                    </Caption>
                  ) : null}
                </div>
                <Body className="font-semibold">{t(lang, opt.titleKey)}</Body>
                <Caption className="text-muted-foreground">{t(lang, opt.bodyKey)}</Caption>
              </button>
            </li>
          );
        })}
      </ul>
    </EnterpriseCard>
  );
}
