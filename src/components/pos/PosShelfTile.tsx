import clsx from "clsx";
import { GripVertical } from "lucide-react";
import type { PointerEvent } from "react";
import type { PosShelfCard } from "../../lib/posShelfOrder";

type Props = {
  shelf: PosShelfCard;
  countLabel: string;
  /** Sell screen: tap to open shelf. Arrange mode: drag to reorder. */
  mode: "sell" | "arrange";
  dragging?: boolean;
  dragOver?: boolean;
  onClick?: () => void;
  onDragPointerDown?: (e: PointerEvent) => void;
  onDragPointerEnter?: () => void;
  onDragPointerUp?: () => void;
};

export function PosShelfTile({
  shelf,
  countLabel,
  mode,
  dragging = false,
  dragOver = false,
  onClick,
  onDragPointerDown,
  onDragPointerEnter,
  onDragPointerUp,
}: Props) {
  const isArrange = mode === "arrange";

  if (isArrange) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-grabbed={dragging}
        className={clsx(
          "relative min-h-[116px] w-full touch-none cursor-grab rounded-[1.35rem] border p-3 text-left shadow-sm transition-all active:cursor-grabbing",
          "border-slate-200 bg-white",
          dragging && "z-10 scale-[0.97] opacity-60 shadow-lg",
          dragOver && "border-waka-400 ring-2 ring-waka-300",
        )}
        onPointerDown={onDragPointerDown}
        onPointerEnter={onDragPointerEnter}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerUp}
      >
        <span
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-stone-100 text-stone-500"
          aria-hidden
        >
          <GripVertical className="h-4 w-4" />
        </span>
        <span className="flex h-full flex-col justify-between pr-8">
          <span>
            <span className="text-2xl" aria-hidden>
              {shelf.icon ?? "▣"}
            </span>
            <span className="mt-2 line-clamp-2 block text-lg font-black leading-tight text-slate-950">
              {shelf.label}
            </span>
          </span>
          <span className="text-xs font-bold text-stone-500">{countLabel}</span>
        </span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[116px] w-full rounded-[1.35rem] border border-slate-200 bg-white p-3 text-left shadow-sm active:border-waka-400 active:bg-waka-50"
    >
      <span className="flex h-full flex-col justify-between">
        <span>
          <span className="text-2xl" aria-hidden>
            {shelf.icon ?? "▣"}
          </span>
          <span className="mt-2 line-clamp-2 block text-lg font-black leading-tight text-slate-950">{shelf.label}</span>
        </span>
        <span className="text-xs font-bold text-stone-500">{countLabel}</span>
      </span>
    </button>
  );
}
