import { useCallback, useEffect, useRef } from "react";

/** Suspends descendant CSS animation only while a Home tile is genuinely off-screen. */
export function useHomeTileVisibility() {
  const elementRef = useRef<HTMLElement | null>(null);
  const intersectingRef = useRef(true);
  const focusedRef = useRef(false);

  const sync = useCallback((visible: boolean) => {
    intersectingRef.current = visible;
    elementRef.current?.toggleAttribute("data-home-anim-offscreen", !visible && !focusedRef.current);
  }, []);

  const setElement = useCallback((element: HTMLElement | null) => {
    elementRef.current = element;
    if (!element) return;
    element.toggleAttribute("data-home-anim-offscreen", !intersectingRef.current);
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) sync(entry.isIntersecting);
      },
      { rootMargin: "96px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [sync]);

  const onFocus = useCallback(() => {
    focusedRef.current = true;
    elementRef.current?.removeAttribute("data-home-anim-offscreen");
  }, []);
  const onBlur = useCallback(() => {
    focusedRef.current = false;
    sync(intersectingRef.current);
  }, [sync]);

  return { setElement, onFocus, onBlur };
}