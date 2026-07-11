import clsx from "clsx";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { HospitalityFloorState, Language, Sale } from "../../types";
import { t } from "../../lib/i18n";
import { TABLE_STATUS_COLORS, floorStatusCounts } from "../../lib/hospitality";
import { NumericKeypad } from "./NumericKeypad";

type ViewFilter = "all" | "occupied" | "available" | "bill";

type Props = {
  lang: Language;
  floor: HospitalityFloorState;
  sales: Sale[];
  tableLookup: string;
  onTableLookupChange: (v: string) => void;
  onTableLookupConfirm: () => void;
  viewFilter: ViewFilter;
  onViewFilterChange: (f: ViewFilter) => void;
};

export function FloorPlanRightPanel({
  lang,
  floor,
  tableLookup,
  onTableLookupChange,
  onTableLookupConfirm,
  viewFilter,
  onViewFilterChange,
}: Props) {
  const counts = floorStatusCounts(floor);

  const filters: { id: ViewFilter; labelKey: string }[] = [
    { id: "all", labelKey: "floorFilterAll" },
    { id: "occupied", labelKey: "floorFilterOccupied" },
    { id: "available", labelKey: "floorFilterAvailable" },
    { id: "bill", labelKey: "floorFilterBill" },
  ];

  return (
    <aside className="hidden shrink-0 flex-col border-l border-border bg-muted lg:flex lg:w-56 xl:w-64">
      <div className="border-b border-border bg-card p-2">
        {filters.map((f, i) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onViewFilterChange(f.id)}
            className={clsx(
              "flex w-full items-center justify-between rounded px-2 py-2 text-left text-xs font-bold",
              viewFilter === f.id ? "bg-sky-100 text-sky-900" : "text-muted-foreground hover:bg-muted",
            )}
          >
            <span>{t(lang, f.labelKey as "floorFilterAll")}</span>
            {i === 0 ? <ChevronUp className="h-3.5 w-3.5 opacity-50" /> : <ChevronDown className="h-3.5 w-3.5 opacity-50" />}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-1 border-b border-border p-2">
        {(Object.keys(TABLE_STATUS_COLORS) as Array<keyof typeof TABLE_STATUS_COLORS>).map((key) => {
          const count =
            key === "available"
              ? counts.available
              : key === "occupied"
                ? counts.occupied
                : key === "payment_pending"
                  ? counts.billRequested
                  : key === "reserved"
                    ? counts.reserved
                    : key === "needs_attention"
                      ? counts.needsAttention
                      : counts.disabled;
          if (key === "disabled" && count === 0) return null;
          const colors = TABLE_STATUS_COLORS[key];
          return (
            <div key={key} className="flex flex-col items-center rounded bg-card py-1.5 shadow-sm">
              <span className={clsx("mb-0.5 h-2 w-2 rounded-full", colors.dot)} />
              <span className="text-sm font-black tabular-nums">{count}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-auto border-t border-border p-2">
        <p className="mb-1 text-center text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "floorTableLookup")}</p>
        <div className="mb-2 rounded border border-border bg-card px-2 py-2 text-center text-lg font-black tabular-nums">
          {tableLookup || "—"}
        </div>
        <NumericKeypad
          value={tableLookup}
          onChange={onTableLookupChange}
          onConfirm={onTableLookupConfirm}
          confirmLabel={t(lang, "floorTableLookupGo")}
        />
      </div>
    </aside>
  );
}
