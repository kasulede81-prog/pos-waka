import type { ReactNode } from "react";
import clsx from "clsx";
import { RefreshCw, type LucideIcon } from "lucide-react";

export function AdminHero({
  greeting,
  subtitle,
  dateLabel,
  roleLabel,
  districtCount,
  onRefresh,
  refreshing,
}: {
  greeting: string;
  subtitle: string;
  dateLabel: string;
  roleLabel: string;
  districtCount: number;
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 p-5 text-white shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase opacity-80">{dateLabel}</div>
          <h1 className="mt-1 text-2xl font-black leading-tight">
            {greeting}, {subtitle}
          </h1>
          <p className="mt-0.5 text-sm opacity-90">
            {roleLabel} · {districtCount} districts
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="shrink-0 rounded-full bg-white/15 p-2.5 hover:bg-white/25 disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={clsx("h-4 w-4", refreshing && "animate-spin")} />
        </button>
      </div>
    </div>
  );
}

export function AdminShortcut({
  href,
  Icon,
  label,
  count,
}: {
  href: string;
  Icon: LucideIcon;
  label: string;
  count: number;
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3 shadow-sm transition hover:border-orange-400"
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-100 text-orange-700">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <div className="text-xs font-bold uppercase text-stone-500">{label}</div>
        <div className="text-lg font-black text-stone-900">{count}</div>
      </div>
    </a>
  );
}

export function AdminMetric({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
      <div className="text-[11px] font-bold uppercase text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-black text-stone-900">{value ?? "—"}</div>
    </div>
  );
}

export function AdminSection({
  id,
  title,
  count,
  children,
}: {
  id?: string;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section id={id} className={id ? "scroll-mt-4" : undefined}>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-stone-600">
        {title}
        {typeof count === "number" ? (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-black text-stone-700">{count}</span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-200 bg-white p-6 text-center text-sm font-medium text-stone-600">
      {children}
    </div>
  );
}

export function AdminCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-2xl border border-stone-200 bg-white shadow-sm", className)}>{children}</div>
  );
}
