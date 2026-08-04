import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { VisionCamera, VisionStreamSession } from "../types";
import { EnterpriseCard } from "../../../components/enterprise/EnterpriseCard";
import { Body, Caption, SectionTitle } from "../../../components/enterprise/EnterpriseTypography";

export function VisionCameraDetailsPanel({
  lang,
  camera,
  session,
}: {
  lang: Language;
  camera: VisionCamera | null;
  session: VisionStreamSession | null;
}) {
  if (!camera) {
    return (
      <EnterpriseCard className="p-4">
        <Caption className="text-muted-foreground">{t(lang, "visionLiveSelectHint")}</Caption>
      </EnterpriseCard>
    );
  }

  const rows: Array<[string, string]> = [
    [t(lang, "visionFieldBrand"), camera.brand || "—"],
    [t(lang, "visionLiveModel"), camera.model || "—"],
    [t(lang, "visionLiveFirmware"), "—"],
    ["IP", camera.ip || "—"],
    [t(lang, "visionFieldZone"), camera.zoneId.replaceAll("_", " ")],
    [t(lang, "visionFieldPos"), camera.assignedPosLabel || "—"],
    [t(lang, "visionFieldRecording"), camera.recordingMode],
    [
      t(lang, "visionTestOnvif"),
      camera.onvifSupported == null
        ? t(lang, "visionTestUnknown")
        : camera.onvifSupported
          ? t(lang, "visionTestSupported")
          : t(lang, "visionTestNotSupported"),
    ],
    [
      t(lang, "visionTestRtsp"),
      camera.rtspUrlMain ? t(lang, "visionTestWorking") : t(lang, "visionTestFailed"),
    ],
    [t(lang, "visionLiveCodec"), session?.health.codec || "—"],
    [t(lang, "visionTestResolution"), session?.health.resolution || "—"],
    [t(lang, "visionTestFps"), session?.health.fps != null ? String(session.health.fps) : "—"],
    [t(lang, "visionLiveStreamMode"), session?.mode === "demo" ? "Demo" : session?.playback.preferred || "—"],
  ];

  return (
    <EnterpriseCard className="space-y-3 p-4">
      <SectionTitle>{camera.name}</SectionTitle>
      <Caption className="text-muted-foreground">{camera.locationLabel}</Caption>
      <dl className="grid gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border/60 px-3 py-2">
            <Caption className="text-muted-foreground">{label}</Caption>
            <Body className="text-sm font-medium">{value}</Body>
          </div>
        ))}
      </dl>
    </EnterpriseCard>
  );
}
