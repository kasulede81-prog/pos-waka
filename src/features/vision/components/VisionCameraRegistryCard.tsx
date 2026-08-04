import { Pencil, Trash2 } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { EnterpriseCard } from "../../../components/enterprise/EnterpriseCard";
import { Body, Caption, MonoNumber } from "../../../components/enterprise/EnterpriseTypography";
import { WakaButton } from "../../../components/ui/wakaPrimitives";
import { VisionCameraTestPanel } from "./VisionCameraTestPanel";
import type { VisionCamera, VisionCameraTestResult } from "../types";
import { resolveVisionCardHealth, visionCardHealthLabelKey } from "../cameraHealth";

export function VisionCameraRegistryCard({
  lang,
  camera,
  lastTest,
  busy,
  showTest,
  onTest,
  onEdit,
  onDelete,
}: {
  lang: Language;
  camera: VisionCamera;
  lastTest: VisionCameraTestResult | null;
  busy: boolean;
  showTest: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const health = resolveVisionCardHealth(camera, lastTest);
  const healthLabel = t(lang, visionCardHealthLabelKey(health));

  return (
    <EnterpriseCard className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Body className="text-lg font-semibold">{camera.name}</Body>
          <Caption className="text-muted-foreground">
            {camera.locationLabel} · {camera.zoneId.replaceAll("_", " ")}
            {camera.profileId !== "custom" ? ` · ${camera.profileId.replaceAll("_", " ")}` : ""}
          </Caption>
        </div>
        <Caption
          className={clsx(
            "font-semibold",
            health === "healthy" && "text-emerald-700 dark:text-emerald-400",
            health === "warning" && "text-amber-700 dark:text-amber-400",
            health === "offline" && "text-rose-700 dark:text-rose-400",
            health === "unknown" && "text-muted-foreground",
          )}
        >
          {health === "healthy" ? "🟢" : health === "warning" ? "🟡" : health === "offline" ? "🔴" : "⚪"}{" "}
          {healthLabel}
        </Caption>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Metric label={t(lang, "visionTestResolution")} value={lastTest?.resolution ?? "—"} />
        <Metric
          label={t(lang, "visionTestFps")}
          value={lastTest?.fps != null ? String(lastTest.fps) : "—"}
          mono
        />
        <Metric
          label={t(lang, "visionTestLatency")}
          value={lastTest?.latencyMs != null ? `${lastTest.latencyMs} ms` : "—"}
          mono
        />
        <Metric label={t(lang, "visionFieldRecording")} value={camera.recordingMode} />
        <Metric
          label={t(lang, "visionLiveLastSeen")}
          value={
            camera.lastSeenAt
              ? new Date(camera.lastSeenAt).toLocaleString()
              : camera.lastTestAt
                ? new Date(camera.lastTestAt).toLocaleString()
                : "—"
          }
        />
        <Metric label={t(lang, "visionFieldBrand")} value={camera.brand || "—"} />
        <Metric label={t(lang, "visionFieldBranch")} value={camera.branchLabel || "—"} />
        <Metric label={t(lang, "visionFieldPos")} value={camera.assignedPosLabel || "—"} />
        <Metric label="IP" value={camera.ip || "—"} mono />
      </dl>

      <div className="flex flex-wrap gap-2">
        <WakaButton type="button" variant="secondary" disabled={busy} onClick={onTest}>
          {t(lang, "visionTestAction")}
        </WakaButton>
        <WakaButton type="button" variant="secondary" onClick={onEdit}>
          <Pencil className="h-4 w-4" aria-hidden />
          {t(lang, "visionEditCamera")}
        </WakaButton>
        <WakaButton type="button" variant="ghost" onClick={onDelete}>
          <Trash2 className="h-4 w-4" aria-hidden />
          {t(lang, "visionDelete")}
        </WakaButton>
      </div>
      {showTest ? <VisionCameraTestPanel lang={lang} result={lastTest} /> : null}
    </EnterpriseCard>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <Caption className="text-muted-foreground">{label}</Caption>
      {mono ? <MonoNumber className="text-sm">{value}</MonoNumber> : <Body>{value}</Body>}
    </div>
  );
}
