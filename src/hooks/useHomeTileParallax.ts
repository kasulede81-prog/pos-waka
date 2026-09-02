import { useCallback, useRef, useState } from "react";
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

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!enabled || e.pointerType === "touch") return;
      const rect = e.currentTarget.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      const spotX = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
      const spotY = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
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
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
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
    sceneStyle,
    cardStyle,
  };
}
