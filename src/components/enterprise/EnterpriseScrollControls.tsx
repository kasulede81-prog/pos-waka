import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { RefObject } from "react";
import {
  scrollEnterpriseContainer,
  useEnterpriseScrollContainer,
  useEnterpriseScrollMetrics,
} from "./useEnterpriseScrollContainer";

type Props = {
  /** Optional explicit scroll container; defaults to `.scroll-main-chrome`. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Hide when parent uses viewport-locked internal scroll (e.g. POS sell). */
  enabled?: boolean;
  className?: string;
};

/**
 * Floating scroll-to-top / scroll-to-bottom controls.
 * Mobile: bottom-right FAB stack. Desktop: compact floaters.
 */
export function EnterpriseScrollControls({ scrollRef, enabled = true, className }: Props) {
  const container = useEnterpriseScrollContainer(scrollRef, enabled);
  const { canScrollUp, canScrollDown } = useEnterpriseScrollMetrics(container);

  if (!enabled || (!canScrollUp && !canScrollDown)) return null;

  return (
    <div
      className={clsx(
        "pointer-events-none fixed z-[35] flex flex-col gap-2",
        "bottom-[calc(var(--waka-bottom-nav-h,0px)+var(--waka-safe-bottom,env(safe-area-inset-bottom,0px))+4.5rem)] right-3",
        "md:bottom-6 md:right-6",
        className,
      )}
      aria-hidden={false}
    >
      {canScrollUp ? (
        <button
          type="button"
          aria-label="Scroll to top"
          onClick={() => scrollEnterpriseContainer(container, "top")}
          className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-200/90 bg-white/95 text-stone-800 shadow-lg backdrop-blur transition-waka hover:bg-stone-50 active:scale-95 md:h-9 md:w-9"
        >
          <ArrowUp className="h-5 w-5 md:h-4 md:w-4" aria-hidden />
        </button>
      ) : null}
      {canScrollDown ? (
        <button
          type="button"
          aria-label="Scroll to bottom"
          onClick={() => scrollEnterpriseContainer(container, "bottom")}
          className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-200/90 bg-white/95 text-stone-800 shadow-lg backdrop-blur transition-waka hover:bg-stone-50 active:scale-95 md:h-9 md:w-9"
        >
          <ArrowDown className="h-5 w-5 md:h-4 md:w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
