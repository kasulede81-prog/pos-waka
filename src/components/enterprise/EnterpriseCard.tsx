import type { HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { wakaUi } from "../../lib/brandTokens";
import { enterpriseTypeClass } from "../../lib/enterpriseTypography";

type Props = HTMLAttributes<HTMLDivElement> & {
  muted?: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

/**
 * Unified enterprise card — padding, radius, header row (Phase 22.2).
 */
export function EnterpriseCard({
  muted,
  title,
  subtitle,
  actions,
  children,
  className,
  ...props
}: Props) {
  return (
    <div className={clsx(muted ? wakaUi.surfaceMuted : wakaUi.surface, "p-4 sm:p-5", className)} {...props}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? <h2 className={enterpriseTypeClass("sectionTitle")}>{title}</h2> : null}
            {subtitle ? (
              <p className={enterpriseTypeClass("body", "mt-0.5 text-muted-foreground")}>{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
