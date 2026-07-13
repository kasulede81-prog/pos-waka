import clsx from "clsx";
import { enterpriseMotion } from "../../lib/enterpriseMotion";

type Variant =
  | "line"
  | "card"
  | "list-row"
  | "kpi"
  | "table-row"
  | "form-field"
  | "avatar"
  | "chip";

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
  "form-field": "h-12 w-full rounded-xl",
  avatar: "h-12 w-12 rounded-2xl",
  chip: "h-8 w-20 rounded-full",
};

export function EnterpriseSkeleton({ variant = "line", className }: Props) {
  return (
    <div
      className={clsx(enterpriseMotion.skeleton, VARIANT_CLASS[variant], className)}
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

/** Table body placeholder — header + rows */
export function EnterpriseSkeletonTable({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading table">
      <div className="flex gap-2">
        {Array.from({ length: columns }, (_, i) => (
          <EnterpriseSkeleton key={i} variant="line" className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <EnterpriseSkeleton key={i} variant="table-row" />
      ))}
    </div>
  );
}

/** Form fields + primary action */
export function EnterpriseSkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading form">
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-2">
          <EnterpriseSkeleton variant="line" className="h-3 w-24" />
          <EnterpriseSkeleton variant="form-field" />
        </div>
      ))}
      <EnterpriseSkeleton variant="form-field" className="h-11 w-full max-w-xs" />
    </div>
  );
}

/** Dashboard shell — KPI row + two cards */
export function EnterpriseSkeletonDashboard() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <EnterpriseSkeletonKpiGrid count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <EnterpriseSkeleton variant="card" className="h-48" />
        <EnterpriseSkeleton variant="card" className="h-48" />
      </div>
    </div>
  );
}

/** Dialog / sheet body */
export function EnterpriseSkeletonDialog() {
  return (
    <div className="space-y-4 px-1" aria-busy="true" aria-label="Loading dialog">
      <EnterpriseSkeleton variant="line" className="h-5 w-2/3" />
      <EnterpriseSkeleton variant="line" className="h-4 w-full" />
      <EnterpriseSkeleton variant="line" className="h-4 w-5/6" />
      <EnterpriseSkeletonForm fields={2} />
    </div>
  );
}

/** Product grid / list for stock & POS browse */
export function EnterpriseSkeletonProductList({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2 rounded-2xl border border-border/60 p-3">
          <EnterpriseSkeleton variant="avatar" className="h-16 w-full rounded-xl" />
          <EnterpriseSkeleton variant="line" className="h-4 w-4/5" />
          <EnterpriseSkeleton variant="line" className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Report summary blocks */
export function EnterpriseSkeletonReport() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading report">
      <EnterpriseSkeleton variant="line" className="h-6 w-48" />
      <EnterpriseSkeletonKpiGrid count={3} />
      <EnterpriseSkeleton variant="card" className="h-56" />
    </div>
  );
}
