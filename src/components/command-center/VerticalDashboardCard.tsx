import clsx from "clsx";
import type { ReactNode } from "react";

type Props = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "emerald" | "amber" | "violet" | "sky";
  className?: string;
  children?: ReactNode;
};

const toneClass: Record<NonNullable<Props["tone"]>, string> = {
  default: "border-border bg-card text-foreground",
  emerald: "border-success/30 bg-success-muted text-success",
  amber: "border-warning/30 bg-warning-muted text-warning-foreground",
  violet: "border-trial/30 bg-trial-muted text-trial",
  sky: "border-info/30 bg-info-muted text-info",
};

export function VerticalDashboardCard({ label, value, hint, tone = "default", className, children }: Props) {
  return (
    <article className={clsx("rounded-2xl border p-4 shadow-sm", toneClass[tone], className)}>
      <p className="text-xs font-black uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
      {hint ? <p className="mt-1 text-xs font-semibold opacity-75">{hint}</p> : null}
      {children}
    </article>
  );
}

export function VerticalDashboardPanel({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("rounded-2xl border border-border bg-card p-4 shadow-sm", className)}>
      <h3 className="text-sm font-black uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}
