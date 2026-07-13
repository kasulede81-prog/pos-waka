import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { WakaButton } from "../ui/wakaPrimitives";
import { emptyStateClasses } from "../../lib/statusTokens";
import { ENTERPRISE_ICON_STROKE, enterpriseIconClass } from "../../lib/enterpriseIcons";
import { enterpriseMotion } from "../../lib/enterpriseMotion";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";

export type EnterpriseEmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  className?: string;
  children?: ReactNode;
};

export function EnterpriseEmptyState({
  icon: Icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
  children,
}: EnterpriseEmptyStateProps) {
  const styles = emptyStateClasses();

  return (
    <div className={clsx(styles.shell, enterpriseMotion.standard, className)}>
      <span className={clsx(styles.icon, "transition-waka")}>
        <Icon className={enterpriseIconClass("lg")} strokeWidth={ENTERPRISE_ICON_STROKE} aria-hidden />
      </span>
      <h3 className={enterpriseTypeClass("sectionTitle", "text-center")}>{title}</h3>
      {description ? (
        <p className={enterpriseTypeClass("body", "mt-2 text-center text-muted-foreground")}>{description}</p>
      ) : null}
      {children}
      {(primaryAction || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {primaryAction ? (
            <WakaButton type="button" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </WakaButton>
          ) : null}
          {secondaryAction ? (
            <WakaButton type="button" variant="secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </WakaButton>
          ) : null}
        </div>
      )}
    </div>
  );
}
