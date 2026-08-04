import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { EnterpriseCard } from "../../../components/enterprise/EnterpriseCard";
import { Body, Caption, MonoNumber, SectionTitle } from "../../../components/enterprise/EnterpriseTypography";
import { recorderHealthLabelKey } from "../recorders";

export type VisionRecorderInstallerSnapshot = {
  connectedDvr: string;
  recorderHealth: "healthy" | "warning" | "offline" | "unknown" | "none";
  storageLabel: string;
  cameraCount: number;
  offlineCameras: number;
  networkStatus: "edge_online" | "edge_offline" | "degraded";
  recording: boolean;
  recorderCount: number;
};

export function VisionInstallerDashboard({
  lang,
  snapshot,
}: {
  lang: Language;
  snapshot: VisionRecorderInstallerSnapshot;
}) {
  const networkLabel =
    snapshot.networkStatus === "edge_online"
      ? t(lang, "visionInstallNetOnline")
      : snapshot.networkStatus === "degraded"
        ? t(lang, "visionInstallNetDegraded")
        : t(lang, "visionInstallNetOffline");

  const cells: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: t(lang, "visionInstallConnectedDvr"), value: snapshot.connectedDvr },
    {
      label: t(lang, "visionInstallRecorderHealth"),
      value: t(lang, recorderHealthLabelKey(snapshot.recorderHealth)),
    },
    { label: t(lang, "visionInstallStorage"), value: snapshot.storageLabel },
    { label: t(lang, "visionInstallCameraCount"), value: String(snapshot.cameraCount), mono: true },
    { label: t(lang, "visionInstallOfflineCams"), value: String(snapshot.offlineCameras), mono: true },
    { label: t(lang, "visionInstallNetwork"), value: networkLabel },
    {
      label: t(lang, "visionInstallRecording"),
      value: snapshot.recording ? t(lang, "visionInstallRecOnDvr") : t(lang, "visionInstallRecNone"),
    },
  ];

  return (
    <EnterpriseCard className="space-y-3 p-4">
      <div>
        <SectionTitle>{t(lang, "visionInstallDashTitle")}</SectionTitle>
        <Caption className="text-muted-foreground">{t(lang, "visionInstallDashSub")}</Caption>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cells.map((cell) => (
          <div key={cell.label} className="rounded-lg border border-border/60 px-3 py-2">
            <Caption className="text-muted-foreground">{cell.label}</Caption>
            {cell.mono ? (
              <MonoNumber className="text-lg font-semibold">{cell.value}</MonoNumber>
            ) : (
              <Body className="text-sm font-medium">{cell.value}</Body>
            )}
          </div>
        ))}
      </dl>
    </EnterpriseCard>
  );
}
