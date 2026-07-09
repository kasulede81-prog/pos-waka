import { useCallback, useEffect, useState, type RefObject } from "react";

const DEFAULT_SELECTOR = ".scroll-main-chrome";

export function resolveEnterpriseScrollContainer(
  ref?: RefObject<HTMLElement | null>,
  selector = DEFAULT_SELECTOR,
): HTMLElement | null {
  if (ref?.current) return ref.current;
  return document.querySelector<HTMLElement>(selector);
}

export function useEnterpriseScrollContainer(
  ref?: RefObject<HTMLElement | null>,
  enabled = true,
): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) {
      setContainer(null);
      return;
    }
    const el = resolveEnterpriseScrollContainer(ref);
    setContainer(el);
    return undefined;
  }, [ref, enabled]);

  return container;
}

export function useEnterpriseScrollMetrics(container: HTMLElement | null, threshold = 120) {
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const refresh = useCallback(() => {
    if (!container) {
      setCanScrollUp(false);
      setCanScrollDown(false);
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    setCanScrollUp(scrollTop > threshold);
    setCanScrollDown(scrollTop + clientHeight < scrollHeight - threshold);
  }, [container, threshold]);

  useEffect(() => {
    if (!container) return;
    refresh();
    container.addEventListener("scroll", refresh, { passive: true });
    const ro = new ResizeObserver(refresh);
    ro.observe(container);
    return () => {
      container.removeEventListener("scroll", refresh);
      ro.disconnect();
    };
  }, [container, refresh]);

  return { canScrollUp, canScrollDown, refresh };
}

export function scrollEnterpriseContainer(
  container: HTMLElement | null,
  direction: "top" | "bottom",
): void {
  if (!container) return;
  container.scrollTo({
    top: direction === "top" ? 0 : container.scrollHeight,
    behavior: "smooth",
  });
}
