import clsx from "clsx";
import { Grid2X2, LayoutGrid, Table2 } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { useInventoryView } from "./InventoryViewContext";
import type { InventoryViewMode, InventoryViewPreference } from "./types";

type Props = {
  lang: Language;
  /** Desktop toolbar vs compact chip row */
  variant?: "toolbar" | "inline";
};

const MODES: { id: InventoryViewMode; icon: typeof Grid2X2; labelKey: string }[] = [
  { id: "card", icon: LayoutGrid, labelKey: "inventoryViewCard" },
  { id: "compact", icon: Grid2X2, labelKey: "inventoryViewCompact" },
  { id: "table", icon: Table2, labelKey: "inventoryViewTable" },
];

export function InventoryViewSwitcher({ lang, variant = "toolbar" }: Props) {
  const { mode, setModeOverride, setPreference } = useInventoryView();

  const select = (next: InventoryViewMode) => {
    setModeOverride(next);
    setPreference(next);
  };

  return (
    <div
      className={clsx(
        "flex items-center gap-1",
        variant === "toolbar" ? "rounded-xl border border-border bg-card p-1" : "flex-wrap",
      )}
      role="group"
      aria-label={t(lang, "inventoryViewSwitcherLabel")}
    >
      {MODES.map(({ id, icon: Icon, labelKey }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            title={t(lang, labelKey)}
            aria-pressed={active}
            onClick={() => select(id)}
            className={clsx(
              "inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-black transition-colors",
              active ? "bg-waka-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted",
              variant === "inline" && "min-h-[32px] px-2",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className={variant === "inline" ? "hidden sm:inline" : "hidden md:inline"}>{t(lang, labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

export type { InventoryViewPreference };
