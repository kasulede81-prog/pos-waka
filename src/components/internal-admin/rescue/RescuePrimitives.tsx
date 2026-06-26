import type { ReactNode } from "react";
import clsx from "clsx";

type Props = {
  id: string;
  title: string;
  summary?: string;
  children: ReactNode;
  className?: string;
};

export function RescueSection({ id, title, summary, children, className }: Props) {
  return (
    <section
      id={id}
      className={clsx("scroll-mt-24 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm lg:p-5", className)}
    >
      <header className="mb-3 border-b border-stone-100 pb-3">
        <h2 className="text-base font-black text-stone-900">{title}</h2>
        {summary ? <p className="mt-0.5 text-xs font-medium text-stone-500">{summary}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function RescueMetricGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-2 min-[640px]:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{children}</dl>
  );
}

export function RescueMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "bg-emerald-50 text-emerald-950"
      : tone === "warn"
        ? "bg-amber-50 text-amber-950"
        : tone === "bad"
          ? "bg-rose-50 text-rose-950"
          : "bg-stone-50 text-stone-900";
  return (
    <div className={clsx("rounded-xl px-3 py-2.5", toneClass)}>
      <dt className="text-[10px] font-bold uppercase tracking-wide opacity-70">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-black">{value}</dd>
    </div>
  );
}

export function RescueRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2 text-sm">
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className="max-w-[65%] text-right font-mono text-xs font-black text-stone-900">{value}</dd>
    </div>
  );
}

export function RescueActionButton({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const cls =
    variant === "danger"
      ? "border-rose-300 bg-rose-50 text-rose-900"
      : variant === "secondary"
        ? "border-stone-300 bg-white text-stone-900"
        : "border-stone-900 bg-stone-900 text-white";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "min-h-[44px] rounded-xl border px-4 text-xs font-black disabled:opacity-40",
        cls,
      )}
    >
      {children}
    </button>
  );
}
