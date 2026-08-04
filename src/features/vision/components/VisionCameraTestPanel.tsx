import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { VisionCameraTestResult } from "../types";
import { Body, Caption, MonoNumber, SectionTitle } from "../../../components/enterprise/EnterpriseTypography";
import { EnterpriseCard } from "../../../components/enterprise/EnterpriseCard";
import clsx from "clsx";

export function VisionCameraTestPanel({
  lang,
  result,
}: {
  lang: Language;
  result: VisionCameraTestResult | null;
}) {
  if (!result) return null;
  const rows: Array<{ label: string; value: string; ok?: boolean | null }> = [
    {
      label: t(lang, "visionTestOnline"),
      value: result.online ? t(lang, "visionStatusOnline") : t(lang, "visionStatusOffline"),
      ok: result.online,
    },
    { label: t(lang, "visionTestResolution"), value: result.resolution ?? "—" },
    { label: t(lang, "visionTestFps"), value: result.fps != null ? String(result.fps) : "—" },
    {
      label: t(lang, "visionTestLatency"),
      value: result.latencyMs != null ? `${result.latencyMs} ms` : "—",
    },
    { label: t(lang, "visionTestSignal"), value: result.signal },
    {
      label: t(lang, "visionTestRecording"),
      value:
        result.recordingDetected == null
          ? t(lang, "visionTestUnknown")
          : result.recordingDetected
            ? t(lang, "visionTestDetected")
            : t(lang, "visionTestNotDetected"),
    },
    {
      label: t(lang, "visionTestOnvif"),
      value:
        result.onvifSupported == null
          ? t(lang, "visionTestUnknown")
          : result.onvifSupported
            ? t(lang, "visionTestSupported")
            : t(lang, "visionTestNotSupported"),
      ok: result.onvifSupported,
    },
    {
      label: t(lang, "visionTestRtsp"),
      value:
        result.rtspWorking == null
          ? t(lang, "visionTestUnknown")
          : result.rtspWorking
            ? t(lang, "visionTestWorking")
            : t(lang, "visionTestFailed"),
      ok: result.rtspWorking,
    },
    {
      label: t(lang, "visionTestSnapshot"),
      value:
        result.snapshotWorking == null
          ? t(lang, "visionTestUnknown")
          : result.snapshotWorking
            ? t(lang, "visionTestWorking")
            : t(lang, "visionTestFailed"),
      ok: result.snapshotWorking,
    },
  ];

  return (
    <EnterpriseCard className="space-y-3 p-4">
      <SectionTitle>{t(lang, "visionTestTitle")}</SectionTitle>
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <li key={row.label} className="rounded-lg border border-border/60 px-3 py-2">
            <Caption className="text-muted-foreground">{row.label}</Caption>
            <Body
              className={clsx(
                "font-medium",
                row.ok === true && "text-emerald-700 dark:text-emerald-400",
                row.ok === false && "text-rose-700 dark:text-rose-400",
              )}
            >
              {row.value}
            </Body>
          </li>
        ))}
      </ul>
      {result.message ? <Caption className="text-muted-foreground">{result.message}</Caption> : null}
      <Caption className="text-muted-foreground">
        {result.viaEdgeAgent ? t(lang, "visionTestViaAgent") : t(lang, "visionTestLocalOnly")} ·{" "}
        <MonoNumber as="span">{new Date(result.testedAt).toLocaleString()}</MonoNumber>
      </Caption>
    </EnterpriseCard>
  );
}
