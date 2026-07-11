import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import type { ShopConsoleTab } from "../../../../lib/shopConsoleState";
import { SHOP_CONSOLE_TABS } from "../../../../lib/shopConsoleState";
import type { ShopConsoleState } from "./useShopConsoleState";

const TAB_LABELS: Record<ShopConsoleTab, string> = {
  overview: "Overview",
  business: "Business",
  devices: "Devices",
  subscriptions: "Subscriptions",
  activity: "Activity",
  audit: "Audit",
  security: "Security",
  support: "Support",
  developer: "Developer",
  ai: "AI",
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
        {SHOP_CONSOLE_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            data-tab={tab}
            onClick={() => onTabChange(tab)}
            className={clsx(
              "shrink-0 rounded-xl px-3 py-2 text-xs font-black transition min-h-[40px]",
              activeTab === tab ? "bg-waka-600 text-white shadow-sm" : "bg-card text-muted-foreground ring-1 ring-border",
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
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
            className="min-h-[36px] rounded-xl bg-waka-600 px-3 text-[11px] font-black text-white disabled:opacity-40"
          >
            Reset Password
          </button>
        ) : null}
        {canSupport ? (
          <button
            type="button"
            disabled={busy}
            onClick={quickHandlers.onForceSync}
            className="min-h-[36px] rounded-xl border border-border px-3 text-[11px] font-black disabled:opacity-40"
          >
            Force Sync
          </button>
        ) : null}
        {canSupport ? (
          <button
            type="button"
            disabled={busy}
            onClick={quickHandlers.onSuspendOrReactivate}
            className={clsx(
              "min-h-[36px] rounded-xl px-3 text-[11px] font-black disabled:opacity-40",
              detail.shop.is_active
                ? "border border-rose-200 text-rose-800"
                : "border border-emerald-300 text-emerald-900",
            )}
          >
            {suspendLabel}
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
          onClick={() => go("audit")}
          className="min-h-[36px] rounded-xl border border-border px-3 text-[11px] font-black"
        >
          Open Audit
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
