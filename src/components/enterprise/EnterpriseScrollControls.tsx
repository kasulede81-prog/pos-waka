import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { RefObject } from "react";
import { themeUi } from "../../lib/themeTokens";
import {
  scrollEnterpriseContainer,
  useEnterpriseScrollContainer,
  useEnterpriseScrollMetrics,
} from "./useEnterpriseScrollContainer";

type Props = {
  scrollRef?: RefObject<HTMLElement | null>;
  enabled?: boolean;
  className?: string;
};

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
          className={clsx(themeUi.fab, themeUi.focusRing, "pointer-events-auto")}
        >
          <ArrowUp className="h-5 w-5 md:h-4 md:w-4" aria-hidden />
        </button>
      ) : null}
      {canScrollDown ? (
        <button
          type="button"
          aria-label="Scroll to bottom"
          onClick={() => scrollEnterpriseContainer(container, "bottom")}
          className={clsx(themeUi.fab, themeUi.focusRing, "pointer-events-auto")}
        >
          <ArrowDown className="h-5 w-5 md:h-4 md:w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
