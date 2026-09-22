import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Activity, ChevronDown, CircleUserRound, Headphones, History, KeyRound, Loader2, MonitorSmartphone, RefreshCw, Settings2, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { enterpriseIconClass, ENTERPRISE_ICON_STROKE } from "../../../../lib/enterpriseIcons";
import type { ShopConsoleTab } from "../../../../lib/shopConsoleState";
import { SHOP_CONSOLE_TABS } from "../../../../lib/shopConsoleState";
import type { ShopConsoleState } from "./useShopConsoleState";

const TAB_LABELS: Record<ShopConsoleTab, string> = {
  summary: "Summary",
  support: "Support",
  devices: "Devices",
  account: "Account",
  history: "History",
  platform: "Platform",
  advanced: "Advanced",
};

const TAB_ICONS: Record<ShopConsoleTab, LucideIcon> = {
  summary: Activity,
  support: Headphones,
  devices: MonitorSmartphone,
  account: CircleUserRound,
  history: History,
  platform: Settings2,
  advanced: ShieldAlert,
};

export type ShopConsoleQuickHandlers = {
  onResetPassword: () => void;
  onForceSync: () => void;
  onSuspendOrReactivate: () => void;
};

type Props = {
  activeTab: ShopConsoleTab;
  onTabChange: (tab: ShopConsoleTab) => void;
  ctx: ShopConsoleState;
  onOpenActions: () => void;
  quickHandlers: ShopConsoleQuickHandlers;
};

export function ShopConsoleTabBar({ activeTab, onTabChange }: Pick<Props, "activeTab" | "onTabChange">) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current?.querySelector(`[data-tab="${activeTab}"]`);
    el?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [activeTab]);

  return (
    <nav
      ref={scrollRef}
      className="sticky top-0 z-20 -mx-4 border-b border-border bg-muted/95 px-4 backdrop-blur-sm"
      aria-label="Shop console sections"
    >
      <div className="flex gap-1 overflow-x-auto py-2 [-webkit-overflow-scrolling:touch]">
        {SHOP_CONSOLE_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <button
              key={tab}
              type="button"
              data-tab={tab}
              onClick={() => onTabChange(tab)}
              className={clsx(
                "inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-black transition",
                activeTab === tab ? "bg-waka-600 text-white shadow-sm" : "bg-card text-muted-foreground ring-1 ring-border",
              )}
            >
              <Icon className={enterpriseIconClass("sm")} strokeWidth={ENTERPRISE_ICON_STROKE} aria-hidden />
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function ShopConsoleQuickActions({ activeTab, onTabChange, ctx, onOpenActions, quickHandlers }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { detail, canSupport, busy } = ctx;
  if (!detail) return null;

  const go = (tab: ShopConsoleTab) => {
    onTabChange(tab);
    setMoreOpen(false);
  };

  const suspendLabel = detail.shop.is_active ? "Suspend Shop" : "Reactivate Shop";

  return (
    <div className="sticky top-[52px] z-10 -mx-4 border-b border-border bg-card px-4 py-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {canSupport ? (
          <button
            type="button"
            disabled={busy}
            onClick={quickHandlers.onResetPassword}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-waka-600 px-3 text-[11px] font-black text-white disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : <KeyRound className="size-3.5" aria-hidden />}
            {busy ? "Working…" : "Reset Password"}
          </button>
        ) : null}
        {canSupport ? (
          <button
            type="button"
            disabled={busy}
            onClick={quickHandlers.onForceSync}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-border px-3 text-[11px] font-black disabled:opacity-40"
          >
            <RefreshCw className={clsx("size-3.5", busy && "animate-spin motion-reduce:animate-none")} aria-hidden />
            {busy ? "Syncing…" : "Force Sync"}
          </button>
        ) : null}
        {canSupport ? (
          <button
            type="button"
            disabled={busy}
            onClick={quickHandlers.onSuspendOrReactivate}
            className={clsx(
              "inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-[11px] font-black disabled:opacity-40",
              detail.shop.is_active
                ? "border border-rose-200 text-rose-800"
                : "border border-emerald-300 text-emerald-900",
            )}
          >
            <ShieldAlert className="size-3.5" aria-hidden />
            {busy ? "Updating…" : suspendLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => go("devices")}
          className="min-h-[36px] rounded-xl border border-border px-3 text-[11px] font-black"
        >
          Open Devices
        </button>
        <button
          type="button"
          onClick={() => go("support")}
          className="min-h-[36px] rounded-xl border border-border px-3 text-[11px] font-black"
        >
          Open Support
        </button>
        <button
          type="button"
          onClick={() => go("history")}
          className="min-h-[36px] rounded-xl border border-border px-3 text-[11px] font-black"
        >
          Open History
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="flex min-h-[36px] items-center gap-1 rounded-xl border border-border px-3 text-[11px] font-black"
          >
            More <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {moreOpen ? (
            <div className="absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-xl border border-border bg-card py-1 shadow-lg">
              {SHOP_CONSOLE_TABS.filter((t) => t !== activeTab).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-xs font-bold text-foreground hover:bg-waka-50"
                  onClick={() => go(tab)}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
              <button
                type="button"
                className="block w-full border-t border-border px-3 py-2 text-left text-xs font-bold text-foreground hover:bg-waka-50"
                onClick={() => {
                  setMoreOpen(false);
                  onOpenActions();
                }}
              >
                All actions…
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { TAB_LABELS };
