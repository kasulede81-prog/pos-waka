import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import type { ReactNode } from "react";
import { enterpriseIconClass, ENTERPRISE_ICON_STROKE } from "../../lib/enterpriseIcons";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
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
      return "border-waka-300 bg-gradient-to-br from-waka-50 to-waka-50/80";
    case "success":
      return clsx(statusTokens.success.badgeRing, statusTokens.success.banner);
    case "warning":
      return clsx(statusTokens.warning.badgeRing, statusTokens.warning.banner);
    case "danger":
      return clsx(statusTokens.danger.badgeRing, statusTokens.danger.banner);
    default:
      return "border-border/90 bg-card";
  }
}

function iconShellClasses(tone: EnterpriseKpiTone): string {
  switch (tone) {
    case "highlight":
      return "bg-waka-600 text-white";
    case "success":
      return clsx(statusTokens.success.badge, "text-success-foreground");
    case "warning":
      return clsx(statusTokens.warning.badge, "text-warning-foreground");
    case "danger":
      return clsx(statusTokens.danger.badge, "text-danger-foreground");
    default:
      return "bg-muted text-muted-foreground";
  }
}

/**
 * Unified KPI / stat card — inventory, customers, cash, reports (Phase 22.3).
 */
export function EnterpriseKpiCard({ icon: Icon, label, value, hint, tone = "default", onClick, className }: Props) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={clsx(
        "flex min-h-[76px] flex-col justify-between rounded-2xl border p-2.5 text-left shadow-sm",
        enterpriseMotion.standard,
        shellClasses(tone),
        onClick && clsx(enterpriseMotion.cardInteractive, enterpriseMotion.focus),
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", iconShellClasses(tone))}>
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
  return <p className="mt-0.5 text-xs font-semibold text-muted-foreground">{children}</p>;
}
