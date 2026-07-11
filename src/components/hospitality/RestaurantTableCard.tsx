import clsx from "clsx";
import type { DiningTable, Language, TableReservation, TableSession } from "../../types";
import { t } from "../../lib/i18n";
import { TABLE_STATUS_COLORS, formatSessionElapsed } from "../../lib/hospitality";
import { formatUgx } from "../../lib/formatUgx";
import { RestaurantTableIcon } from "./RestaurantTableIcon";
import type { ResolvedFloorDisplayPrefs } from "../../lib/floorDisplayPrefs";

type Props = {
  lang: Language;
  table: DiningTable;
  session?: TableSession;
  reservation?: TableReservation;
  totalUgx: number;
  display: ResolvedFloorDisplayPrefs;
  onTap: () => void;
};

export function RestaurantTableCard({
  lang,
  table,
  session,
  reservation,
  totalUgx,
  display,
  onTap,
}: Props) {
  const colors = TABLE_STATUS_COLORS[table.displayStatus];
  const elapsed = session ? formatSessionElapsed(session.openedAt) : null;
  const disabled = table.displayStatus === "disabled" || table.displayStatus === "blocked";

  return (
    <button
      type="button"
      onClick={onTap}
      disabled={disabled}
      className={clsx(
        "group flex flex-col items-center rounded-xl border border-transparent p-2 transition active:scale-[0.97] disabled:opacity-45",
        session && "bg-white/60",
      )}
    >
      <RestaurantTableIcon
        label={table.label}
        status={table.displayStatus}
        size={display.tableSize}
        shape={display.tableShape}
      />
      {session ? (
        <div className="mt-1 w-full max-w-[120px] space-y-0.5 text-center">
          <p className="text-[10px] font-bold text-muted-foreground">
            {session.guestCount} {t(lang, "tableOrderGuests")}
            {elapsed ? ` · ${elapsed}` : ""}
          </p>
          {totalUgx > 0 ? (
            <p className="text-xs font-black tabular-nums text-foreground">{formatUgx(totalUgx)}</p>
          ) : null}
        </div>
      ) : reservation ? (
        <p className="mt-1 max-w-[120px] truncate text-center text-[10px] font-bold text-violet-800">
          {reservation.guestName}
        </p>
      ) : table.displayStatus !== "available" ? (
        <p className={clsx("mt-1 text-[10px] font-bold", colors.text)}>{t(lang, colors.labelKey)}</p>
      ) : null}
    </button>
  );
}
