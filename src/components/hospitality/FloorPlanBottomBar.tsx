import clsx from "clsx";
import {
  BarChart3,
  Briefcase,
  Calendar,
  ClipboardList,
  LayoutDashboard,
  LayoutGrid,
} from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Tab = "home" | "floor" | "reservations" | "documents" | "stats" | "tools";

type Props = {
  lang: Language;
  active: Tab;
  onHome: () => void;
  onFloor: () => void;
  onReservations: () => void;
  onDocuments: () => void;
  onStats: () => void;
  onTools: () => void;
  showDocuments?: boolean;
  showStats?: boolean;
  showTools?: boolean;
};

export function FloorPlanBottomBar({
  lang,
  active,
  onHome,
  onFloor,
  onReservations,
  onDocuments,
  onStats,
  onTools,
  showDocuments = false,
  showStats = false,
  showTools = false,
}: Props) {
  const btn = (tab: Tab, onClick: () => void, label: string, Icon: typeof LayoutGrid) => (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-wide sm:min-h-14 sm:flex-row sm:gap-2 sm:text-xs",
        active === tab
          ? "bg-orange-600 text-white shadow-[0_6px_18px_rgba(234,88,12,0.22)]"
          : "bg-orange-50 text-orange-950 active:bg-orange-100 dark:bg-orange-950/30 dark:text-orange-100 dark:active:bg-orange-950/50",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-center leading-tight">{label}</span>
    </button>
  );

  return (
    <div className="shrink-0 border-t-2 border-sky-800 bg-sky-600 p-1.5 sm:p-2">
      <div className="mx-auto flex max-w-5xl gap-1 sm:gap-1.5">
        {btn("home", onHome, t(lang, "navHome"), LayoutDashboard)}
        {btn("floor", onFloor, t(lang, "floorNavSituation"), LayoutGrid)}
        {btn("reservations", onReservations, t(lang, "floorNavReserve"), Calendar)}
        {showDocuments ? btn("documents", onDocuments, t(lang, "floorNavDocuments"), ClipboardList) : null}
        {showStats ? btn("stats", onStats, t(lang, "floorNavStats"), BarChart3) : null}
        {showTools ? btn("tools", onTools, t(lang, "hospitalityBusinessToolsNav"), Briefcase) : null}
      </div>
    </div>
  );
}
