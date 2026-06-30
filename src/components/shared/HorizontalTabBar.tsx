import clsx from "clsx";

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
  return (
    <div
      className={clsx(
        "-mx-1 overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch]",
        className,
      )}
    >
      <div role="tablist" aria-label={ariaLabel} className="flex min-w-min gap-2 px-1">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={tab.disabled}
              onClick={() => onChange(tab.id)}
              className={clsx(
                "touch-manipulation shrink-0 rounded-2xl border-2 px-4 py-2.5 text-sm font-black transition-colors",
                "min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-400 focus-visible:ring-offset-2",
                active
                  ? "border-stone-900 bg-stone-900 text-white shadow-sm"
                  : "border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50",
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
