import clsx from "clsx";
import type { TableDisplayStatus } from "../../types";
import { TABLE_STATUS_COLORS } from "../../lib/hospitality";
import { TABLE_ICON_PX, type ResolvedFloorDisplayPrefs } from "../../lib/floorDisplayPrefs";

type Props = {
  label: string;
  status: TableDisplayStatus;
  size: ResolvedFloorDisplayPrefs["tableSize"];
  shape: ResolvedFloorDisplayPrefs["tableShape"];
  selected?: boolean;
};

export function RestaurantTableIcon({ label, status, size, shape, selected }: Props) {
  const px = TABLE_ICON_PX[size];
  const colors = TABLE_STATUS_COLORS[status];
  const shortLabel = label.replace(/^Table\s*/i, "").trim() || label;

  return (
    <div
      className={clsx(
        "relative flex flex-col items-center justify-center",
        selected && "ring-2 ring-sky-500 ring-offset-2 rounded-xl",
      )}
      style={{ width: px + 24, minHeight: px + 28 }}
    >
      <div className="relative" style={{ width: px, height: px }}>
        {shape === "classic" ? (
          <>
            <span
              className={clsx(
                "absolute left-1 top-1 h-3 w-3 rounded-sm border border-stone-400/80",
                colors.bg,
              )}
            />
            <span
              className={clsx(
                "absolute right-1 top-1 h-3 w-3 rounded-sm border border-stone-400/80",
                colors.bg,
              )}
            />
            <span
              className={clsx(
                "absolute bottom-1 left-1 h-3 w-3 rounded-sm border border-stone-400/80",
                colors.bg,
              )}
            />
            <span
              className={clsx(
                "absolute bottom-1 right-1 h-3 w-3 rounded-sm border border-stone-400/80",
                colors.bg,
              )}
            />
            <div
              className={clsx(
                "absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] shadow-inner",
                colors.border,
                colors.bg,
              )}
              style={{ width: px * 0.55, height: px * 0.55 }}
            >
              <span className={clsx("text-center text-[10px] font-black leading-none", colors.text)}>
                {shortLabel.slice(0, 4)}
              </span>
            </div>
          </>
        ) : (
          <div
            className={clsx(
              "flex h-full w-full items-center justify-center border-[3px] shadow-sm",
              shape === "round" ? "rounded-full" : "rounded-lg",
              colors.border,
              colors.bg,
            )}
          >
            <span className={clsx("text-center text-xs font-black", colors.text)}>{shortLabel.slice(0, 4)}</span>
          </div>
        )}
        <span
          className={clsx("absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white", colors.dot)}
          aria-hidden
        />
      </div>
      <p className={clsx("mt-1 max-w-full truncate text-center text-[11px] font-black", colors.text)}>
        {label}
      </p>
    </div>
  );
}
