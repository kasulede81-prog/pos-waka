import clsx from "clsx";
import type { CSSProperties, PointerEvent, Ref } from "react";
import type { ResolvedHomeTile } from "../../lib/launcherTiles";
import {
  launcherTileColorClasses,
  launcherTileSurfaceStyle,
  scaleToShelfSize,
  shelfGridSpanStyle,
  shelfTypographyFromScale,
} from "../../lib/launcherTiles";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  tile: ResolvedHomeTile;
  lang: Language;
  mode: "live" | "arrange";
  variant: "sell" | "secondary";
  dragging?: boolean;
  dragOver?: boolean;
  selected?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick?: () => void;
  onDragPointerDown?: (e: PointerEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
};

export function HomeLauncherTile({
  tile,
  lang,
  mode,
  variant,
  dragging = false,
  dragOver = false,
  selected = false,
  buttonRef,
  onClick,
  onDragPointerDown,
  onKeyDown,
}: Props) {
  const isSell = variant === "sell";
  const isArrange = mode === "arrange";
  const typo = shelfTypographyFromScale(isSell ? 85 : tile.scale);
  const layoutSize = scaleToShelfSize(tile.scale);
  const customStyle = isSell ? undefined : launcherTileSurfaceStyle(tile);
  const colorClass = isSell
    ? ""
    : customStyle
      ? ""
      : launcherTileColorClasses(tile.color, tile.pinned);
  const spanStyle = isSell ? undefined : shelfGridSpanStyle(tile.scale);
  const combinedStyle = spanStyle || customStyle ? { ...spanStyle, ...customStyle } : undefined;
  const iconStyle: CSSProperties = {
    width: `${isSell ? 3 : typo.iconRem}rem`,
    height: `${isSell ? 3 : typo.iconRem}rem`,
  };
  const titleStyle: CSSProperties = isSell
    ? {}
    : { fontSize: `${typo.titleRem}rem`, fontWeight: 900, lineHeight: 1.08 };

  const isBoldSecondary = !isSell && (customStyle || tile.color !== "default");
  const defaultIconTint = !isSell && !customStyle && tile.color === "default";

  return (
    <button
      ref={buttonRef}
      type="button"
      data-launcher-key={isSell ? undefined : tile.id}
      style={combinedStyle}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerDown={isArrange && !isSell ? onDragPointerDown : undefined}
      className={clsx(
        "relative touch-manipulation rounded-2xl border-2 text-center shadow-md transition-all",
        "hover:shadow-lg active:scale-[0.98] motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waka-500 focus-visible:ring-offset-2 focus-visible:ring-offset-waka-50",
        isSell
          ? clsx(
              "col-span-2 flex w-full flex-col items-center justify-center gap-3 border-white/30 bg-gradient-to-br from-waka-600 to-waka-700 px-4 py-6 text-white",
              "min-h-[140px] shadow-[0_8px_32px_rgba(234,88,12,0.4)] hover:from-waka-500 hover:to-waka-600",
              "lg:min-h-[200px] lg:gap-4 lg:px-6 lg:py-8",
            )
          : clsx(
              "flex h-full min-h-0 flex-col items-center justify-center gap-2 px-3 py-3",
              isBoldSecondary ? "font-black" : "shadow-waka-sm hover:shadow-md",
              colorClass,
              tile.hidden && isArrange && "opacity-45",
              isArrange && "cursor-grab active:cursor-grabbing",
              isArrange && selected && "ring-2 ring-waka-500 ring-offset-2",
              isArrange && dragging && "z-20 scale-[1.02] opacity-90 shadow-lg",
              isArrange && dragOver && "ring-2 ring-dashed ring-waka-400",
              layoutSize === "large" && "gap-3",
            ),
      )}
    >
      {isArrange && !isSell ? (
        <span
          className={clsx(
            "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide",
            isBoldSecondary ? "bg-white/20 text-white" : "bg-stone-900/10 text-stone-600",
          )}
          aria-hidden
        >
          ⋮⋮
        </span>
      ) : null}
      {tile.badge !== undefined && tile.badge > 0 ? (
        <span className="absolute right-3 top-3 flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-black text-white">
          {tile.badge > 99 ? "99+" : tile.badge}
        </span>
      ) : null}
      {tile.hidden && isArrange ? (
        <span className="absolute left-2 top-2 rounded-full bg-stone-800/80 px-2 py-0.5 text-[10px] font-bold text-white">
          {t(lang, "homeMenuTileHidden")}
        </span>
      ) : null}
      <tile.Icon
        className={clsx("shrink-0", isSell ? "lg:h-16 lg:w-16" : defaultIconTint && "text-waka-600")}
        style={isSell ? { width: "3rem", height: "3rem" } : iconStyle}
        strokeWidth={isSell || isBoldSecondary ? 2.5 : 2}
        aria-hidden
      />
      <span
        className={clsx(
          isSell
            ? "text-2xl font-black uppercase tracking-wide lg:text-3xl"
            : clsx("line-clamp-2 break-words leading-tight", isBoldSecondary && "font-black uppercase tracking-wide"),
        )}
        style={titleStyle}
      >
        {t(lang, tile.labelKey)}
      </span>
    </button>
  );
}
