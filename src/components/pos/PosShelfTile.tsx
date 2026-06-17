import clsx from "clsx";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import type { PosShelfDisplayCard } from "../../lib/posShelfLayout";
import {
  scaleToShelfSize,
  shelfColorClasses,
  shelfGridSpanStyle,
  shelfMinHeightClass,
  shelfTileSurfaceStyle,
  shelfTypographyFromScale,
} from "../../lib/posShelfLayout";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";

type Props = {
  shelf: PosShelfDisplayCard;
  countLabel: string;
  lang: Language;
  /** Sell screen: tap to open shelf. Arrange mode: drag to reorder. */
  mode: "sell" | "arrange";
  dragging?: boolean;
  dragOver?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onDragPointerDown?: (e: PointerEvent) => void;
};

function badgeLabel(lang: Language, shelf: PosShelfDisplayCard): string | null {
  if (shelf.featured && shelf.badge !== "promotion") return t(lang, "posShelfBadgeFeatured");
  if (shelf.badge === "fast_moving") return t(lang, "posShelfBadgeFastMoving");
  if (shelf.badge === "promotion") return t(lang, "posShelfBadgePromotion");
  return null;
}

function ShelfTileBody({
  shelf,
  countLabel,
  isArrange,
  typo,
}: {
  shelf: PosShelfDisplayCard;
  countLabel: string;
  isArrange: boolean;
  typo: ReturnType<typeof shelfTypographyFromScale>;
}): ReactNode {
  const layoutSize = scaleToShelfSize(shelf.scale);
  const arrangePad = isArrange ? "pr-7" : "";
  const titleStyle: CSSProperties = { fontSize: `${typo.titleRem}rem`, fontWeight: 900, lineHeight: 1.08 };
  const countStyle: CSSProperties = { fontSize: `${typo.countRem}rem`, fontWeight: 700, opacity: 0.78 };
  const iconStyle: CSSProperties = { fontSize: `${typo.iconRem}rem`, lineHeight: 1 };

  if (layoutSize === "large") {
    return (
      <span className={clsx("flex h-full min-h-0 flex-col justify-center overflow-hidden text-center", arrangePad)}>
        <span className="line-clamp-3 break-words" style={titleStyle}>
          {shelf.label}
        </span>
        <span className="mt-1 shrink-0 opacity-80" style={iconStyle} aria-hidden>
          {shelf.icon ?? "📦"}
        </span>
        <span className="mt-1 shrink-0 truncate" style={countStyle}>
          {countLabel}
        </span>
      </span>
    );
  }

  return (
    <span className={clsx("flex h-full min-h-0 items-center gap-1.5 overflow-hidden sm:gap-2", arrangePad)}>
      <span className="shrink-0 leading-none opacity-85" style={iconStyle} aria-hidden>
        {shelf.icon ?? "📦"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden">
        <span className="line-clamp-2 break-words" style={titleStyle}>
          {shelf.label}
        </span>
        <span className="mt-0.5 truncate" style={countStyle}>
          {countLabel}
        </span>
      </span>
    </span>
  );
}

export function PosShelfTile({
  shelf,
  countLabel,
  lang,
  mode,
  dragging = false,
  dragOver = false,
  selected = false,
  onClick,
  onDragPointerDown,
}: Props) {
  const isArrange = mode === "arrange";
  const badge = badgeLabel(lang, shelf);
  const typo = shelfTypographyFromScale(shelf.scale);
  const customStyle = shelfTileSurfaceStyle(shelf);
  const isBold = Boolean(customStyle) || shelf.color !== "default";
  const colorClass = customStyle ? "" : shelfColorClasses(shelf.color, shelf.featured);
  const heightClass = shelfMinHeightClass(shelf.size);
  const layoutSize = scaleToShelfSize(shelf.scale);
  const tilePadding: CSSProperties = { padding: `${typo.paddingRem}rem` };

  const inner = (
    <>
      {badge ? (
        <span
          className={clsx(
            "absolute right-2 top-2 max-w-[46%] truncate rounded-full px-1.5 py-0.5 font-black uppercase tracking-wide",
            layoutSize === "large" ? "text-[10px] sm:text-xs" : "text-[9px]",
            isBold ? "bg-white/20 text-white" : "bg-black/10 text-stone-800",
          )}
        >
          {badge}
        </span>
      ) : null}
      <ShelfTileBody shelf={shelf} countLabel={countLabel} isArrange={isArrange} typo={typo} />
      {isArrange ? (
        <span
          className={clsx(
            "absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg",
            isBold ? "bg-white/20 text-white" : "bg-black/5 text-stone-500",
          )}
          aria-hidden
        >
          ⠿
        </span>
      ) : null}
    </>
  );

  const sharedClass = clsx(
    "relative w-full touch-manipulation overflow-hidden rounded-2xl border text-left shadow-sm transition-all",
    heightClass,
    colorClass,
    selected && "ring-2 ring-waka-500 ring-offset-1",
    dragging && "z-10 scale-[0.98] opacity-60 shadow-lg",
    dragOver && "ring-2 ring-waka-400",
    !isArrange && "active:scale-[0.98]",
  );

  const sharedStyle: CSSProperties = {
    ...shelfGridSpanStyle(shelf.scale),
    ...tilePadding,
    ...customStyle,
  };

  if (isArrange) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-shelf-key={shelf.key}
        aria-grabbed={dragging}
        aria-selected={selected}
        className={clsx(sharedClass, "cursor-grab active:cursor-grabbing select-none")}
        style={sharedStyle}
        onPointerDown={onDragPointerDown}
        onClick={onClick}
      >
        {inner}
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} className={sharedClass} style={sharedStyle}>
      {inner}
    </button>
  );
}
