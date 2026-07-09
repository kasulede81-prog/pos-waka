import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { WakaButton } from "../ui/wakaPrimitives";

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
  return (
    <div
      className={clsx(
        "flex flex-col items-center rounded-2xl border border-dashed border-stone-200 bg-stone-50/80 px-6 py-10 text-center",
        className,
      )}
    >
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-stone-600 shadow-sm ring-1 ring-stone-200/80">
        <Icon className="h-7 w-7" strokeWidth={2} aria-hidden />
      </span>
      <h3 className="mt-4 text-lg font-black text-stone-950">{title}</h3>
      {description ? <p className="mt-2 max-w-md text-sm font-medium text-stone-600">{description}</p> : null}
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
