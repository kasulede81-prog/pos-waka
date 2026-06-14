import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  title: string;
  subtitle?: string;
  badgeCount?: number;
  defaultOpen?: boolean;
  collapsible?: boolean;
  className?: string;
  children: ReactNode;
};

export function OwnerDashboardSection({
  title,
  subtitle,
  badgeCount,
  defaultOpen = true,
  collapsible = true,
  className = "",
  children,
}: Props) {
  if (!collapsible) {
    return (
      <section className={`rounded-[1.75rem] border border-slate-200/90 bg-white p-5 shadow-sm ${className}`}>
        <SectionHeader title={title} subtitle={subtitle} badgeCount={badgeCount} />
        <div className="mt-4">{children}</div>
      </section>
    );
  }

  return (
    <details
      open={defaultOpen || undefined}
      className={`group rounded-[1.75rem] border border-slate-200/90 bg-white shadow-sm ${className}`}
    >
      <summary className="cursor-pointer list-none rounded-[1.75rem] p-5 marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-3">
          <SectionHeader title={title} subtitle={subtitle} badgeCount={badgeCount} />
          <ChevronDown
            className="mt-1 h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </div>
      </summary>
      <div className="border-t border-slate-100 px-5 pb-5 pt-4">{children}</div>
    </details>
  );
}

function SectionHeader({
  title,
  subtitle,
  badgeCount,
}: {
  title: string;
  subtitle?: string;
  badgeCount?: number;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-black text-slate-900">{title}</h2>
        {badgeCount != null && badgeCount > 0 ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-950">
            {badgeCount}
          </span>
        ) : null}
      </div>
      {subtitle ? <p className="mt-1 text-sm font-medium text-slate-600">{subtitle}</p> : null}
    </div>
  );
}
