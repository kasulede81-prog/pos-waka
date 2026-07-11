import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { ChevronRight, RefreshCw, X } from "lucide-react";
import { WakaCheckbox } from "../../enterprise/WakaCheckbox";
import { themeUi } from "../../../lib/themeTokens";

export function RoleGate({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return <>{children}</>;
}

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-dashed border-border bg-card/80 px-4 py-10 text-center text-sm font-semibold text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function KpiPulseCard({
  label,
  value,
  onOpen,
  accent = false,
}: {
  label: string;
  value: string;
  onOpen?: () => void;
  accent?: boolean;
}) {
  const inner = (
    <>
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <motion.span
        className={clsx("mt-1 font-mono text-xl font-black", accent ? "text-waka-700" : "text-foreground")}
        animate={{ opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
      >
        {value}
      </motion.span>
      {onOpen ? (
        <span className="mt-2 inline-flex min-h-[44px] items-center gap-0.5 text-[11px] font-bold text-waka-600">
          View <ChevronRight className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </>
  );

  const className = clsx(
    "flex min-h-[88px] flex-col p-3.5 text-left transition active:scale-[0.98]",
    themeUi.adminSurface,
  );

  if (!onOpen) {
    return <div className={className}>{inner}</div>;
  }

  return (
    <motion.button type="button" onClick={onOpen} className={className} whileTap={{ scale: 0.97 }}>
      {inner}
    </motion.button>
  );
}

function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  useBodyScrollLock(open);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[var(--waka-z-internal-admin-modal,70)] flex flex-col justify-end sm:justify-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="presentation"
          onClick={onClose}
        >
          <motion.div
            className={clsx("absolute inset-0 backdrop-blur-[2px]", themeUi.overlay)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            role="dialog"
            aria-modal
            aria-labelledby="admin-sheet-title"
            className={clsx(
              "relative mx-auto flex max-h-[min(92dvh,900px)] w-full flex-col overflow-hidden rounded-t-3xl bg-dialog shadow-2xl sm:max-h-[85dvh] sm:rounded-3xl",
              wide ? "sm:max-w-3xl" : "sm:max-w-lg",
            )}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-center pt-2 sm:hidden">
              <span className="h-1 w-10 rounded-full bg-border" aria-hidden />
            </div>
            <div className={clsx("flex shrink-0 items-start justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-top))]", themeUi.dialogHeader)}>
              <div className="min-w-0">
                <h2 id="admin-sheet-title" className="text-base font-black text-foreground">
                  {title}
                </h2>
                {subtitle ? <p className="mt-0.5 text-xs font-medium text-muted-foreground">{subtitle}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className={clsx("flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-muted-foreground hover:bg-muted", themeUi.focusRing)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {children}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

export function AdminHeroV2({
  greeting,
  firstName,
  dateLabel,
  roleLabel,
  districtCount,
  onRefresh,
  refreshing,
  previewBadge,
}: {
  greeting: string;
  firstName: string;
  dateLabel: string;
  roleLabel: string;
  districtCount: number;
  onRefresh: () => void;
  refreshing?: boolean;
  previewBadge?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-gradient-to-br from-waka-500 via-waka-600 to-waka-700 p-4 text-white shadow-lg shadow-waka-500/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">{dateLabel}</p>
          <h1 className="mt-1 text-xl font-black leading-tight sm:text-2xl">
            {greeting}, {firstName}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold capitalize backdrop-blur-sm">
              {roleLabel}
            </span>
            <span className="text-xs opacity-90">
              {districtCount} {districtCount === 1 ? "district" : "districts"}
            </span>
            {previewBadge ? (
              <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-black uppercase text-amber-950">
                Preview
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-2xl bg-white/15 hover:bg-white/25 disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={clsx("h-5 w-5", refreshing && "animate-spin")} />
        </button>
      </div>
    </motion.div>
  );
}

export function ShopCard({
  name,
  shopNumber,
  district,
  planCode,
  isActive,
  ownerLabel,
  productCount,
  salesHint,
  healthScore,
  healthLevel,
  selected,
  onToggleSelect,
  onOpen,
}: {
  name: string;
  shopNumber?: string | null;
  district: string;
  planCode: string;
  isActive: boolean;
  ownerLabel?: string;
  productCount?: number;
  salesHint?: string;
  healthScore?: number;
  healthLevel?: "green" | "yellow" | "red";
  selected?: boolean;
  onToggleSelect?: () => void;
  onOpen: () => void;
}) {
  const healthCls =
    healthLevel === "green"
      ? "bg-emerald-100 text-emerald-800"
      : healthLevel === "yellow"
        ? "bg-amber-100 text-amber-800"
        : healthLevel === "red"
          ? "bg-rose-100 text-rose-800"
          : null;

  return (
    <motion.div
      className={clsx(
        "w-full rounded-2xl border bg-card p-4 text-left shadow-sm transition",
        selected ? "border-waka-400 ring-2 ring-waka-200" : "border-border/90 hover:border-waka-300/60",
      )}
      whileTap={{ scale: 0.99 }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {onToggleSelect ? (
            <WakaCheckbox
              checked={Boolean(selected)}
              onCheckedChange={() => onToggleSelect()}
              row={false}
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              {shopNumber ? (
                <span className="rounded-md bg-foreground px-2 py-0.5 font-mono text-[11px] font-black text-background">
                  {shopNumber}
                </span>
              ) : null}
              <p className="truncate text-base font-black text-foreground">{name}</p>
            </div>
            {ownerLabel ? <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">{ownerLabel}</p> : null}
          </button>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {healthScore != null && healthCls ? (
            <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-black", healthCls)}>
              {healthScore}%
            </span>
          ) : null}
          <span
            className={clsx(
              "rounded-full px-2 py-0.5 text-[10px] font-black uppercase",
              isActive ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground",
            )}
          >
            {isActive ? "Active" : "Inactive"}
          </span>
        </div>
      </div>
      <button type="button" onClick={onOpen} className="w-full text-left">
      <p className="mt-2 text-xs font-semibold text-muted-foreground">
        <span className="text-muted-foreground">📍</span> {district || "—"} · <span className="uppercase text-waka-800">{planCode}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {productCount != null ? `${productCount} products` : null}
        {productCount != null && salesHint ? " · " : null}
        {salesHint ?? null}
      </p>
      <p className="mt-3 text-right text-xs font-black uppercase text-waka-600">Open →</p>
      </button>
    </motion.div>
  );
}

export function SupportTicketCard({
  title,
  shopName,
  phone,
  ownerEmail,
  status,
  timeLabel,
  onWhatsApp,
  onResolve,
  onOpenShop,
  onDelete,
  showActions,
}: {
  title: string;
  shopName: string;
  phone?: string;
  ownerEmail?: string | null;
  status: string;
  timeLabel: string;
  onWhatsApp?: () => void;
  onResolve?: () => void;
  onOpenShop?: () => void;
  onDelete?: () => void;
  showActions: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-black text-foreground">{title}</p>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
          {status}
        </span>
      </div>
      <p className="mt-1 text-sm font-semibold text-muted-foreground">{shopName}</p>
      {ownerEmail ? <p className="font-mono text-xs text-muted-foreground">{ownerEmail}</p> : null}
      {phone ? <p className="text-xs text-muted-foreground">{phone}</p> : null}
      <p className="mt-1 text-[11px] text-muted-foreground">{timeLabel}</p>
      {showActions ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {onWhatsApp ? (
            <button
              type="button"
              onClick={onWhatsApp}
              className="min-h-[44px] rounded-xl bg-emerald-600 px-3 text-xs font-black text-white"
            >
              WhatsApp
            </button>
          ) : null}
          {onResolve ? (
            <button type="button" onClick={onResolve} className="min-h-[44px] rounded-xl bg-waka-600 px-3 text-xs font-black text-white">
              Resolve
            </button>
          ) : null}
          {onOpenShop ? (
            <button type="button" onClick={onOpenShop} className="min-h-[44px] rounded-xl border border-border px-3 text-xs font-black">
              Open shop
            </button>
          ) : null}
          {onDelete ? (
            <button type="button" onClick={onDelete} className="min-h-[44px] rounded-xl border border-rose-200 px-3 text-xs font-black text-rose-700">
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function PlanCardV2({
  name,
  activeCount,
  trialCount,
  expiringCount,
  mrrUgx,
}: {
  name: string;
  activeCount: number;
  trialCount: number;
  expiringCount: number;
  mrrUgx: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">Plan</p>
      <h3 className="text-lg font-black text-foreground">{name}</h3>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">Active</dt>
          <dd className="font-mono font-black">{activeCount}</dd>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">Trials</dt>
          <dd className="font-mono font-black">{trialCount}</dd>
        </div>
        <div className="rounded-xl bg-waka-50 px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-waka-700">Expiring</dt>
          <dd className="font-mono font-black text-waka-800">{expiringCount}</dd>
        </div>
        <div className="rounded-xl bg-muted px-2.5 py-2">
          <dt className="text-[10px] font-bold uppercase text-muted-foreground">Est. MRR</dt>
          <dd className="font-mono text-xs font-black">UGX {mrrUgx.toLocaleString("en-UG")}</dd>
        </div>
      </dl>
    </div>
  );
}
