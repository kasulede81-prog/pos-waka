import { useCallback, useRef, useState } from "react";

const MAX_PX = 4;

/** Subtle desktop parallax on the active living dashboard card (2–4px max). */
export function useHomeTileParallax(enabled: boolean) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const frameRef = useRef<number | null>(null);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled || e.pointerType === "touch") return;
      const rect = e.currentTarget.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;
      const ny = (e.clientY - rect.top) / rect.height - 0.5;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        setOffset({
          x: Math.round(nx * MAX_PX * 10) / 10,
          y: Math.round(ny * MAX_PX * 10) / 10,
        });
      });
    },
    [enabled],
  );

  const onPointerLeave = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    setOffset({ x: 0, y: 0 });
  }, []);

  return {
    onPointerMove,
    onPointerLeave,
    sceneStyle: enabled
      ? { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }
      : undefined,
  };
}
