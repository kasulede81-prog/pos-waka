import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { EnterpriseCard } from "../../../components/enterprise/EnterpriseCard";
import { Body, Caption, MonoNumber, SectionTitle } from "../../../components/enterprise/EnterpriseTypography";
import type { VisionMonitorDashboard } from "../workspace/monitorDashboard";

export function VisionMonitorDashboardPanel({
  lang,
  dash,
}: {
  lang: Language;
  dash: VisionMonitorDashboard;
}) {
  const cells: Array<{ label: string; value: string; tone?: string }> = [
    { label: t(lang, "visionMonTotal"), value: String(dash.total) },
    { label: t(lang, "visionMonOnline"), value: String(dash.online), tone: "text-emerald-700 dark:text-emerald-400" },
    { label: t(lang, "visionMonWarning"), value: String(dash.warning), tone: "text-amber-700 dark:text-amber-400" },
    { label: t(lang, "visionMonOffline"), value: String(dash.offline), tone: "text-rose-700 dark:text-rose-400" },
    { label: t(lang, "visionMonRecording"), value: String(dash.recording) },
    { label: t(lang, "visionMonLastEvent"), value: dash.lastEventLabel },
    { label: t(lang, "visionMonActiveRecorder"), value: dash.activeRecorder },
  ];

  return (
    <EnterpriseCard className="space-y-3 p-4">
      <SectionTitle>{t(lang, "visionMonDashTitle")}</SectionTitle>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-lg border border-border/60 px-3 py-2">
            <Caption className="text-muted-foreground">{cell.label}</Caption>
            {/^\d+$/.test(cell.value) ? (
              <MonoNumber className={`text-lg font-semibold ${cell.tone ?? ""}`}>{cell.value}</MonoNumber>
            ) : (
              <Body className={`text-sm font-medium ${cell.tone ?? ""}`}>{cell.value}</Body>
            )}
          </div>
        ))}
      </dl>
    </EnterpriseCard>
  );
}
