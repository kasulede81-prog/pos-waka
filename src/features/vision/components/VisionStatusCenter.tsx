import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { EnterpriseCard } from "../../../components/enterprise/EnterpriseCard";
import { Body, Caption, SectionTitle } from "../../../components/enterprise/EnterpriseTypography";
import type { VisionCamera, VisionEdgeAgentInfo } from "../types";
import { resolveVisionCardHealth } from "../cameraHealth";
import type { VisionMonitorDashboard } from "../workspace/monitorDashboard";

export function VisionStatusCenter({
  lang,
  cameras,
  dash,
  agent,
  selected,
}: {
  lang: Language;
  cameras: VisionCamera[];
  dash: VisionMonitorDashboard;
  agent: VisionEdgeAgentInfo | null;
  selected: VisionCamera | null;
}) {
  const healthy = cameras.filter((c) => resolveVisionCardHealth(c) === "healthy").length;
  const warning = cameras.filter((c) => resolveVisionCardHealth(c) === "warning").length;
  const offline = cameras.filter((c) => resolveVisionCardHealth(c) === "offline").length;

  const network =
    dash.networkStatus === "edge_online"
      ? t(lang, "visionInstallNetOnline")
      : dash.networkStatus === "degraded"
        ? t(lang, "visionInstallNetDegraded")
        : t(lang, "visionInstallNetOffline");

  return (
    <EnterpriseCard className="space-y-3 p-4">
      <SectionTitle>{t(lang, "visionStatusCenterTitle")}</SectionTitle>
      <ul className="space-y-2 text-sm">
        <StatusRow tone="healthy" label={`${t(lang, "visionHealthHealthy")} · ${healthy}`} />
        <StatusRow tone="warning" label={`${t(lang, "visionHealthWarning")} · ${warning}`} />
        <StatusRow tone="offline" label={`${t(lang, "visionHealthOffline")} · ${offline}`} />
        <li className="flex justify-between gap-2 border-t border-border/50 pt-2">
          <Caption className="text-muted-foreground">{t(lang, "visionMonRecording")}</Caption>
          <Body className="text-sm font-medium">{dash.recording}</Body>
        </li>
        <li className="flex justify-between gap-2">
          <Caption className="text-muted-foreground">{t(lang, "visionTestLatency")}</Caption>
          <Body className="text-sm font-medium">
            {selected?.lastTestAt ? t(lang, "visionStatusLatencyHint") : "—"}
          </Body>
        </li>
        <li className="flex justify-between gap-2">
          <Caption className="text-muted-foreground">{t(lang, "visionInstallNetwork")}</Caption>
          <Body className="text-sm font-medium">{network}</Body>
        </li>
        <li className="flex justify-between gap-2">
          <Caption className="text-muted-foreground">{t(lang, "visionEdgeStatus")}</Caption>
          <Body className="text-sm font-medium">
            {agent?.available ? `v${agent.version ?? "—"}` : t(lang, "visionEdgeOffline")}
          </Body>
        </li>
      </ul>
    </EnterpriseCard>
  );
}

function StatusRow({ tone, label }: { tone: "healthy" | "warning" | "offline"; label: string }) {
  return (
    <li
      className={clsx(
        "rounded-md px-2 py-1.5 font-medium",
        tone === "healthy" && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
        tone === "warning" && "bg-amber-500/10 text-amber-800 dark:text-amber-300",
        tone === "offline" && "bg-rose-500/10 text-rose-800 dark:text-rose-300",
      )}
    >
      {tone === "healthy" ? "🟢" : tone === "warning" ? "🟡" : "🔴"} {label}
    </li>
  );
}
