import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { EnterpriseCard } from "../../../components/enterprise/EnterpriseCard";
import { Body, Caption } from "../../../components/enterprise/EnterpriseTypography";
import type { VisionRecorderView } from "../recorders";
import { recorderHealthLabelKey } from "../recorders";

export function VisionRecorderCard({
  lang,
  recorder,
  selected,
  onSelect,
}: {
  lang: Language;
  recorder: VisionRecorderView;
  selected: boolean;
  onSelect: () => void;
}) {
  const healthLabel = t(lang, recorderHealthLabelKey(recorder.health));
  const hddLabel =
    recorder.hddStatus === "ok"
      ? t(lang, "visionRecHddOk")
      : recorder.hddStatus === "low"
        ? t(lang, "visionRecHddLow")
        : recorder.hddStatus === "full"
          ? t(lang, "visionRecHddFull")
          : t(lang, "visionHealthUnknown");

  return (
    <button type="button" onClick={onSelect} className="w-full text-left">
      <EnterpriseCard
        className={clsx(
          "space-y-2 p-4 transition",
          selected ? "border-primary ring-2 ring-primary/25" : "hover:bg-muted/30",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Body className="text-lg font-semibold">{recorder.name}</Body>
            <Caption className="text-muted-foreground">
              {[recorder.brand, recorder.model].filter(Boolean).join(" · ") || "—"}
              {recorder.host ? ` · ${recorder.host}` : ""}
            </Caption>
          </div>
          <Caption
            className={clsx(
              "font-semibold",
              recorder.health === "healthy" && "text-emerald-700 dark:text-emerald-400",
              recorder.health === "warning" && "text-amber-700 dark:text-amber-400",
              recorder.health === "offline" && "text-rose-700 dark:text-rose-400",
              (recorder.health === "unknown" || recorder.health === ("none" as string)) &&
                "text-muted-foreground",
            )}
          >
            {recorder.health === "healthy" ? "🟢" : recorder.health === "warning" ? "🟡" : recorder.health === "offline" ? "🔴" : "⚪"}{" "}
            {healthLabel}
          </Caption>
        </div>
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Caption className="text-muted-foreground">{t(lang, "visionInstallCameraCount")}</Caption>
            <Body>
              {recorder.cameraCount} · {recorder.onlineCount} {t(lang, "visionMonOnline").toLowerCase()}
            </Body>
          </div>
          <div>
            <Caption className="text-muted-foreground">{t(lang, "visionInstallRecording")}</Caption>
            <Body>
              {recorder.recordingActive ? t(lang, "visionInstallRecOnDvr") : t(lang, "visionInstallRecNone")}
            </Body>
          </div>
          <div>
            <Caption className="text-muted-foreground">{t(lang, "visionRecHdd")}</Caption>
            <Body>
              {recorder.capacityLabel} · {hddLabel}
            </Body>
          </div>
          <div>
            <Caption className="text-muted-foreground">{t(lang, "visionLiveLastSeen")}</Caption>
            <Body>
              {recorder.lastSeenAt ? new Date(recorder.lastSeenAt).toLocaleString() : "—"}
            </Body>
          </div>
        </dl>
        {recorder.firmware ? (
          <Caption className="text-muted-foreground">
            {t(lang, "visionLiveFirmware")}: {recorder.firmware}
          </Caption>
        ) : null}
      </EnterpriseCard>
    </button>
  );
}
