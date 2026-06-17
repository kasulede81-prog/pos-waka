import clsx from "clsx";
import type { PointerEvent } from "react";
import type { PosShelfDisplayCard } from "../../lib/posShelfLayout";
import {
  shelfColorClasses,
  shelfGridSpanClass,
  shelfMinHeightClass,
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
  const colorClass = shelfColorClasses(shelf.color, shelf.featured);
  const spanClass = shelfGridSpanClass(shelf.size);
  const heightClass = shelfMinHeightClass(shelf.size);
  const titleClass =
    shelf.size === "large"
      ? "text-base font-black leading-tight sm:text-lg"
      : shelf.size === "medium"
        ? "text-sm font-black leading-tight sm:text-base"
        : "text-xs font-black leading-tight sm:text-sm";

  const inner = (
    <>
      {badge ? (
        <span className="absolute right-2 top-2 max-w-[46%] truncate rounded-full bg-black/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide">
          {badge}
        </span>
      ) : null}
      <span className={clsx("flex h-full flex-col justify-between gap-1", isArrange && "pr-7")}>
        <span className="flex min-w-0 items-start gap-1.5">
          <span className={clsx("shrink-0", shelf.size === "large" ? "text-2xl" : "text-lg")} aria-hidden>
            {shelf.icon ?? "📦"}
          </span>
          <span className={clsx("line-clamp-2 min-w-0 flex-1", titleClass)}>{shelf.label}</span>
        </span>
        <span className="text-[10px] font-bold opacity-70 sm:text-[11px]">{countLabel}</span>
      </span>
      {isArrange ? (
        <span
          className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/5 text-stone-500"
          aria-hidden
        >
          ⠿
        </span>
      ) : null}
    </>
  );

  const sharedClass = clsx(
    "relative w-full touch-manipulation rounded-2xl border p-2.5 text-left shadow-sm transition-all",
    spanClass,
    heightClass,
    colorClass,
    selected && "ring-2 ring-waka-500 ring-offset-1",
    dragging && "z-10 scale-[0.98] opacity-60 shadow-lg",
    dragOver && "ring-2 ring-waka-400",
    !isArrange && "active:scale-[0.98]",
  );

  if (isArrange) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-shelf-key={shelf.key}
        aria-grabbed={dragging}
        aria-selected={selected}
        className={clsx(sharedClass, "cursor-grab active:cursor-grabbing select-none")}
        onPointerDown={onDragPointerDown}
        onClick={onClick}
      >
        {inner}
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} className={sharedClass}>
      {inner}
    </button>
  );
}
