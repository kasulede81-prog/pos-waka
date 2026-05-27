import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { ChevronDown, RefreshCw, X, type LucideIcon } from "lucide-react";

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
    <div className="rounded-2xl bg-gradient-to-br from-orange-500 to-orange-700 p-3.5 text-white shadow-md sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase opacity-80 sm:text-xs">{dateLabel}</div>
          <h1 className="mt-0.5 text-lg font-black leading-tight sm:mt-1 sm:text-2xl">
            {greeting}, {subtitle}
          </h1>
          <p className="mt-0.5 text-xs opacity-90 sm:text-sm">
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

export type AdminSelectOption = {
  value: string;
  label: string;
  count?: number;
  group?: string;
  disabled?: boolean;
};

/** Mobile-first section picker — one control instead of a horizontal tab strip. */
export function AdminSectionSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: AdminSelectOption[];
  className?: string;
}) {
  const grouped = options.reduce<Map<string, AdminSelectOption[]>>((acc, opt) => {
    const g = opt.group ?? "";
    const list = acc.get(g) ?? [];
    list.push(opt);
    acc.set(g, list);
    return acc;
  }, new Map());

  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-stone-500">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[48px] w-full appearance-none rounded-xl border border-stone-200 bg-white py-2.5 pl-3 pr-10 text-sm font-bold text-stone-900 outline-none ring-orange-200 focus:border-orange-400 focus:ring-2"
        >
          {[...grouped.entries()].map(([group, items]) =>
            group ? (
              <optgroup key={group} label={group}>
                {items.map((opt) => (
                  <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                    {opt.label}
                    {typeof opt.count === "number" ? ` (${opt.count})` : ""}
                  </option>
                ))}
              </optgroup>
            ) : (
              items.map((opt) => (
                <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                  {typeof opt.count === "number" ? ` (${opt.count})` : ""}
                </option>
              ))
            ),
          )}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
      </div>
    </label>
  );
}

export type AdminActionOption = {
  id: string;
  label: string;
  group: string;
  disabled?: boolean;
  confirm?: string;
};

/** Compact action picker for shop / user admin screens. */
export function AdminActionPicker({
  label,
  runLabel,
  placeholder,
  actions,
  busy,
  onRun,
}: {
  label: string;
  runLabel: string;
  placeholder?: string;
  actions: AdminActionOption[];
  busy?: boolean;
  onRun: (actionId: string) => void;
}) {
  const [picked, setPicked] = useState("");

  return (
    <AdminCard className="p-3 sm:p-4">
      <AdminSectionSelect
        label={label}
        value={picked}
        onChange={setPicked}
        options={[
          { value: "", label: placeholder ?? "Choose action…" },
          ...actions.map((a) => ({
            value: a.id,
            label: a.label,
            group: a.group,
            disabled: a.disabled,
          })),
        ]}
      />
      <button
        type="button"
        disabled={!picked || busy}
        onClick={() => {
          if (!picked) return;
          const action = actions.find((a) => a.id === picked);
          if (action?.confirm && !window.confirm(action.confirm)) return;
          onRun(picked);
          setPicked("");
        }}
        className="mt-3 min-h-[48px] w-full rounded-xl bg-orange-600 text-sm font-black text-white disabled:opacity-40 active:bg-orange-700"
      >
        {busy ? "…" : runLabel}
      </button>
    </AdminCard>
  );
}

export function AdminCollapsible({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-2xl border border-stone-200 bg-white shadow-sm" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 sm:px-4 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="text-sm font-black text-stone-900">{title}</p>
          {summary ? <p className="mt-0.5 truncate text-xs font-medium text-stone-500">{summary}</p> : null}
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-stone-400 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-stone-100 px-3 pb-3 pt-2 sm:px-4 sm:pb-4">{children}</div>
    </details>
  );
}

export function AdminOpsPanel({
  title,
  subtitle,
  open,
  onClose,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="waka-internal-admin-modal fixed inset-0 flex items-end justify-center bg-stone-950/55 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4 sm:pb-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={clsx(
          "flex max-h-[min(88dvh,900px)] w-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl sm:max-h-[min(92dvh,900px)]",
          wide ? "max-w-5xl" : "max-w-2xl",
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-stone-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-base font-black text-stone-900 sm:text-lg">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs font-semibold text-stone-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl p-2 text-stone-600 hover:bg-stone-50"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 [-webkit-overflow-scrolling:touch] sm:px-5 sm:py-4">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function OpsPanelNavButton({
  label,
  count,
  active,
  onClick,
  Icon,
}: {
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
  Icon: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition",
        active
          ? "border-orange-600 bg-orange-600 text-white shadow-sm"
          : "border-stone-200 bg-white text-stone-700 hover:border-orange-300 hover:bg-orange-50",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      <span>{label}</span>
      {typeof count === "number" ? (
        <span
          className={clsx(
            "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
            active ? "bg-white/20 text-white" : "bg-stone-100 text-stone-700",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
