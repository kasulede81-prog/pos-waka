import clsx from "clsx";
import { BarChart3, Calendar, ClipboardList, LayoutGrid } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Tab = "floor" | "reservations" | "documents" | "stats";

type Props = {
  lang: Language;
  active: Tab;
  onFloor: () => void;
  onReservations: () => void;
  onDocuments: () => void;
  onStats: () => void;
};

export function FloorPlanBottomBar({ lang, active, onFloor, onReservations, onDocuments, onStats }: Props) {
  const btn = (tab: Tab, onClick: () => void, label: string, Icon: typeof LayoutGrid) => (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-2 text-[10px] font-black uppercase tracking-wide sm:min-h-14 sm:flex-row sm:gap-2 sm:text-xs",
        active === tab
          ? "bg-sky-700 text-white shadow-inner"
          : "bg-sky-600 text-sky-50 active:bg-sky-700",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="text-center leading-tight">{label}</span>
    </button>
  );

  return (
    <div className="shrink-0 border-t-2 border-sky-800 bg-sky-600 p-1.5 sm:p-2">
      <div className="mx-auto flex max-w-5xl gap-1 sm:gap-1.5">
        {btn("floor", onFloor, t(lang, "floorNavSituation"), LayoutGrid)}
        {btn("reservations", onReservations, t(lang, "floorNavReserve"), Calendar)}
        {btn("documents", onDocuments, t(lang, "floorNavDocuments"), ClipboardList)}
        {btn("stats", onStats, t(lang, "floorNavStats"), BarChart3)}
      </div>
    </div>
  );
}
