import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { ChevronDown, RefreshCw, type LucideIcon } from "lucide-react";
import { themeUi } from "../../lib/themeTokens";

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
    <div className="rounded-2xl bg-gradient-to-br from-waka-500 to-waka-700 p-3.5 text-white shadow-md sm:p-5">
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
      className={clsx("flex items-center gap-3 p-3 transition hover:border-waka-400", themeUi.adminSurface)}
    >
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-business-muted text-waka-700">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <div className="text-xs font-bold uppercase text-muted-foreground">{label}</div>
        <div className="text-lg font-black text-foreground">{count}</div>
      </div>
    </a>
  );
}

export function AdminMetric({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className={clsx("p-3", themeUi.adminSurface)}>
      <div className="text-[11px] font-bold uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-black text-foreground">{value ?? "—"}</div>
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
      <h2 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
        {title}
        {typeof count === "number" ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-black text-muted-foreground">{count}</span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm font-medium text-muted-foreground">
      {children}
    </div>
  );
}

export function AdminCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-2xl border border-border bg-card shadow-sm", className)}>{children}</div>
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
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[48px] w-full appearance-none rounded-xl border border-border bg-card py-2.5 pl-3 pr-10 text-sm font-bold text-foreground outline-none ring-waka-200 focus:border-waka-400 focus:ring-2"
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
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
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
        className="mt-3 min-h-[48px] w-full rounded-xl bg-waka-600 text-sm font-black text-white disabled:opacity-40 active:bg-waka-700"
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
    <details className="group rounded-2xl border border-border bg-card shadow-sm" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 sm:px-4 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="text-sm font-black text-foreground">{title}</p>
          {summary ? <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">{summary}</p> : null}
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border px-3 pb-3 pt-2 sm:px-4 sm:pb-4">{children}</div>
    </details>
  );
}

import { BottomSheet } from "./v2/primitives";

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
  return (
    <BottomSheet open={open} onClose={onClose} title={title} subtitle={subtitle} wide={wide}>
      {children}
    </BottomSheet>
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
          ? "border-waka-600 bg-waka-600 text-white shadow-sm"
          : "border-border bg-card text-muted-foreground hover:border-waka-300 hover:bg-waka-50",
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      <span>{label}</span>
      {typeof count === "number" ? (
        <span
          className={clsx(
            "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
            active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
