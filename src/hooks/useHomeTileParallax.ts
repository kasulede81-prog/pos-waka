import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";

const MAX_PX = 4;

type TilePointerState = {
  x: number;
  y: number;
  spotX: number;
  spotY: number;
  active: boolean;
};

const REST: TilePointerState = { x: 0, y: 0, spotX: 50, spotY: 20, active: false };

/**
 * Fine-pointer surface response for Home tiles (2–4px art drift + CSS spotlight).
 * Touch is ignored here — press feedback stays on :active / transform.
 */
export function useHomeTileParallax(enabled: boolean) {
  const [state, setState] = useState<TilePointerState>(REST);
  const frameRef = useRef<number | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const pendingRef = useRef<{ clientX: number; clientY: number } | null>(null);

  const measure = useCallback(() => {
    rectRef.current = elementRef.current?.getBoundingClientRect() ?? null;
  }, []);

  const setElement = useCallback((element: HTMLElement | null) => {
    elementRef.current = element;
    rectRef.current = element?.getBoundingClientRect() ?? null;
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!enabled || e.pointerType === "touch") return;
      pendingRef.current = { clientX: e.clientX, clientY: e.clientY };
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const rect = rectRef.current;
        const pending = pendingRef.current;
        if (!rect || !pending || rect.width === 0 || rect.height === 0) return;
        const nx = (pending.clientX - rect.left) / rect.width - 0.5;
        const ny = (pending.clientY - rect.top) / rect.height - 0.5;
        const spotX = Math.round(((pending.clientX - rect.left) / rect.width) * 1000) / 10;
        const spotY = Math.round(((pending.clientY - rect.top) / rect.height) * 1000) / 10;
        setState({
          x: Math.round(nx * MAX_PX * 10) / 10,
          y: Math.round(ny * MAX_PX * 10) / 10,
          spotX,
          spotY,
          active: true,
        });
      });
    },
    [enabled],
  );

  const onPointerLeave = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pendingRef.current = null;
    setState(REST);
  }, []);

  const sceneStyle: CSSProperties | undefined = enabled
    ? { transform: `translate3d(${state.x}px, ${state.y}px, 0)` }
    : undefined;

  const cardStyle: CSSProperties | undefined = enabled
    ? ({
        "--home-spot-x": `${state.spotX}%`,
        "--home-spot-y": `${state.spotY}%`,
        "--home-spot-opacity": state.active ? 1 : 0,
      } as CSSProperties)
    : undefined;

  return {
    onPointerMove,
    onPointerLeave,
    onPointerEnter: measure,
    setElement,
    sceneStyle,
    cardStyle,
  };
}
