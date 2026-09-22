import clsx from "clsx";
import { AlertCircle, Inbox, Loader2, WifiOff, type LucideIcon } from "lucide-react";
import { WakaSymbolIcon } from "../brand/WakaLogo";
import { WakaButton } from "../ui/wakaPrimitives";
import { enterpriseIconClass, ENTERPRISE_ICON_STROKE } from "../../lib/enterpriseIcons";
import { EnterpriseSkeleton, EnterpriseSkeletonKpiGrid, EnterpriseSkeletonList } from "./EnterpriseSkeleton";

export function WakaPageLoading({
  message = "Loading your workspace…",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "waka-loading-stage flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background px-6 text-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className="relative flex max-w-sm flex-col items-center text-center">
        <div className="waka-loading-halo" aria-hidden />
        <span className="relative grid size-20 place-items-center rounded-2xl border border-border bg-card shadow-elev-md">
          <WakaSymbolIcon size="md" className="size-14" />
        </span>
        <p className="mt-6 font-display text-lg font-bold">WAKA</p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{message}</p>
        <span className="mt-5 h-1 w-32 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="waka-loading-progress block h-full w-1/2 rounded-full bg-primary" />
        </span>
      </div>
    </div>
  );
}

export function WakaInlineLoading({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span className={clsx("inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground", className)} role="status">
      <Loader2 className={clsx(enterpriseIconClass("sm"), "animate-spin motion-reduce:animate-none")} strokeWidth={ENTERPRISE_ICON_STROKE} aria-hidden />
      {label}
    </span>
  );
}

export function WakaAdminOverviewSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading Command Center" aria-busy="true">
      <EnterpriseSkeleton variant="card" className="h-36" />
      <EnterpriseSkeleton variant="card" className="h-24" />
      <EnterpriseSkeletonKpiGrid count={5} />
      <EnterpriseSkeletonList count={4} />
    </div>
  );
}

export function WakaCustomerListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading customers" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <EnterpriseSkeleton variant="avatar" className="size-11 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <EnterpriseSkeleton variant="line" className="w-2/5" />
              <EnterpriseSkeleton variant="line" className="h-3 w-3/4" />
              <div className="flex gap-2"><EnterpriseSkeleton variant="chip" /><EnterpriseSkeleton variant="chip" /></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WakaSupportQueueSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading support queue" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2"><EnterpriseSkeleton variant="line" className="w-3/5" /><EnterpriseSkeleton variant="line" className="h-3 w-4/5" /></div>
            <EnterpriseSkeleton variant="chip" className="w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WakaCustomerWorkspaceSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading Customer Workspace" aria-busy="true">
      <div className="rounded-lg border border-border bg-card p-4">
        <EnterpriseSkeleton variant="line" className="h-3 w-28" />
        <EnterpriseSkeleton variant="line" className="mt-3 h-7 w-1/2" />
        <EnterpriseSkeleton variant="line" className="mt-2 w-3/4" />
        <div className="mt-3 flex gap-2"><EnterpriseSkeleton variant="chip" /><EnterpriseSkeleton variant="chip" /></div>
      </div>
      <div className="flex gap-2 overflow-hidden">{Array.from({ length: 5 }, (_, index) => <EnterpriseSkeleton key={index} variant="chip" className="shrink-0" />)}</div>
      <EnterpriseSkeleton variant="card" className="h-48" />
      <EnterpriseSkeletonList count={3} />
    </div>
  );
}

type WakaStateTone = "empty" | "error" | "offline";

const STATE_ICON: Record<WakaStateTone, LucideIcon> = {
  empty: Inbox,
  error: AlertCircle,
  offline: WifiOff,
};

export function WakaStatePanel({
  title,
  description,
  tone = "empty",
  action,
  className,
}: {
  title: string;
  description?: string;
  tone?: WakaStateTone;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  const Icon = STATE_ICON[tone];
  return (
    <div className={clsx("rounded-lg border border-dashed border-border bg-card px-5 py-8 text-center", className)} role={tone === "error" ? "alert" : "status"}>
      <Icon className={clsx("mx-auto size-6", tone === "error" ? "text-destructive" : tone === "offline" ? "text-warning" : "text-muted-foreground")} strokeWidth={ENTERPRISE_ICON_STROKE} aria-hidden />
      <p className="mt-3 text-sm font-bold text-foreground">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">{description}</p> : null}
      {action ? <WakaButton variant="secondary" className="mt-4" onClick={action.onClick}>{action.label}</WakaButton> : null}
    </div>
  );
}