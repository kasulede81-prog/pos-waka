import clsx from "clsx";
import { themeUi } from "../../lib/themeTokens";

type Variant = "line" | "card" | "list-row" | "kpi" | "table-row";

type Props = {
  variant?: Variant;
  className?: string;
  count?: number;
};

const VARIANT_CLASS: Record<Variant, string> = {
  line: "h-4 w-full rounded-lg",
  card: "h-28 w-full rounded-2xl",
  "list-row": "h-[72px] w-full rounded-2xl",
  kpi: "h-24 w-full rounded-2xl",
  "table-row": "h-11 w-full rounded-lg",
};

export function EnterpriseSkeleton({ variant = "line", className }: Props) {
  return (
    <div
      className={clsx(themeUi.skeleton, VARIANT_CLASS[variant], className)}
      aria-hidden
    />
  );
}

export function EnterpriseSkeletonList({
  variant = "list-row",
  count = 5,
  className,
}: {
  variant?: Variant;
  count?: number;
  className?: string;
}) {
  return (
    <div className={clsx("space-y-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <EnterpriseSkeleton key={i} variant={variant} />
      ))}
    </div>
  );
}

export function EnterpriseSkeletonKpiGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <EnterpriseSkeleton key={i} variant="kpi" />
      ))}
    </div>
  );
}
