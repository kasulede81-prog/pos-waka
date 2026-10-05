import clsx from "clsx";
import { useRef, type KeyboardEvent } from "react";

export type HorizontalTab = {
  id: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  tabs: HorizontalTab[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
};

/** Horizontally scrollable tabs — same on mobile and desktop. */
export function HorizontalTabBar({ tabs, activeId, onChange, ariaLabel, className }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * WAI-ARIA tabs pattern: roving tabindex (active tab is the only tab stop)
   * plus Left/Right/Home/End navigation with automatic activation. The active
   * tab re-renders on change, so focus is re-applied after commit.
   */
  const focusTab = (id: string) => {
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus();
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.filter((tab) => !tab.disabled);
    if (enabled.length === 0) return;
    const activeIndex = enabled.findIndex((tab) => tab.id === activeId);
    const base = activeIndex >= 0 ? activeIndex : 0;
    let next: HorizontalTab | null = null;
    if (e.key === "ArrowRight") next = enabled[(base + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(base - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    focusTab(next.id);
  };

  return (
    <div
      ref={listRef}
      className={clsx(
        "-mx-1 overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch]",
        className,
      )}
    >
      <div role="tablist" aria-label={ariaLabel} className="flex min-w-min gap-2 px-1" onKeyDown={handleKeyDown}>
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-tab={tab.id}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={clsx(
                "touch-manipulation shrink-0 rounded-2xl border-2 px-4 py-2.5 text-sm font-black transition-colors",
                "min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-400 focus-visible:ring-offset-2",
                active
                  ? "border-foreground bg-foreground text-background shadow-sm"
                  : "border-border bg-card text-muted-foreground hover:border-border hover:bg-muted",
                tab.disabled && "cursor-not-allowed opacity-40",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
