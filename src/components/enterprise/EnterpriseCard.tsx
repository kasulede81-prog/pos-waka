import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { themeUi } from "../../lib/themeTokens";
import { enterpriseSpace } from "../../lib/enterpriseSpacing";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";
import { enterpriseMotion } from "../../lib/enterpriseMotion";

type Props = HTMLAttributes<HTMLDivElement> & {
  muted?: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Skip default card padding (rare — nested layouts) */
  flush?: boolean;
};

/**
 * Canonical production card — Phase 22.2 + Phase 29.1 elevation/spacing.
 * Prefer this over ad-hoc `rounded-2xl border …` shells.
 */
export function EnterpriseCard({
  muted,
  title,
  subtitle,
  actions,
  children,
  className,
  flush,
  ...props
}: Props) {
  return (
    <div
      className={clsx(
        muted ? themeUi.surfaceMuted : themeUi.surface,
        enterpriseMotion.standard,
        !flush && enterpriseSpace.cardPad,
        className,
      )}
      {...props}
    >
      {title || actions ? (
        <div className={clsx("flex flex-wrap items-start justify-between", enterpriseSpace.controlGap, enterpriseSpace.sectionGap)}>
          <div className="min-w-0">
            {title ? <h2 className={enterpriseTypeClass("sectionTitle")}>{title}</h2> : null}
            {subtitle ? (
              <p className={enterpriseTypeClass("body", "mt-1 text-muted-foreground")}>{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className={clsx("flex shrink-0 flex-wrap", enterpriseSpace.controlGap)}>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
