import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import type { ReactNode } from "react";
import { enterpriseIconClass, ENTERPRISE_ICON_STROKE } from "../../lib/enterpriseIcons";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import { enterpriseSpace } from "../../lib/enterpriseSpacing";
import { statusTokens } from "../../lib/statusTokens";
import { Caption, MonoNumber } from "./EnterpriseTypography";

export type EnterpriseKpiTone = "default" | "highlight" | "success" | "warning" | "danger";

type Props = {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: EnterpriseKpiTone;
  onClick?: () => void;
  className?: string;
};

function shellClasses(tone: EnterpriseKpiTone): string {
  switch (tone) {
    case "highlight":
      return "border-waka-300/80 bg-waka-50/90 dark:border-waka-700/50 dark:bg-waka-950/30";
    case "success":
      return clsx(statusTokens.success.badgeRing, statusTokens.success.banner);
    case "warning":
      return clsx(statusTokens.warning.badgeRing, statusTokens.warning.banner);
    case "danger":
      return clsx(statusTokens.danger.badgeRing, statusTokens.danger.banner);
    default:
      return "border-border bg-card";
  }
}

function iconShellClasses(tone: EnterpriseKpiTone): string {
  switch (tone) {
    case "highlight":
      return "bg-primary text-primary-foreground";
    case "success":
      return statusTokens.success.icon;
    case "warning":
      return statusTokens.warning.icon;
    case "danger":
      return statusTokens.danger.icon;
    default:
      return "bg-muted text-muted-foreground";
  }
}

/**
 * Unified KPI / stat card — inventory, customers, cash, reports, hospitality (Phase 22.3 / 29.1).
 */
export function EnterpriseKpiCard({ icon: Icon, label, value, hint, tone = "default", onClick, className }: Props) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={clsx(
        "flex min-h-[80px] flex-col justify-between rounded-2xl border text-left shadow-elev",
        enterpriseSpace.kpiPad,
        enterpriseMotion.standard,
        shellClasses(tone),
        onClick && clsx(enterpriseMotion.cardInteractive, enterpriseMotion.focus),
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", iconShellClasses(tone))}>
          <Icon className={enterpriseIconClass("sm")} strokeWidth={ENTERPRISE_ICON_STROKE} aria-hidden />
        </span>
        <Caption className="line-clamp-2 normal-case leading-tight">{label}</Caption>
      </div>
      <div>
        {typeof value === "string" || typeof value === "number" ? (
          <MonoNumber className="text-base sm:text-lg">{value}</MonoNumber>
        ) : (
          value
        )}
        {hint ? <BodyMuted>{hint}</BodyMuted> : null}
      </div>
    </Tag>
  );
}

function BodyMuted({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-xs font-semibold text-muted-foreground">{children}</p>;
}
