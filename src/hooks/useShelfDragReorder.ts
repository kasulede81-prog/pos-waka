import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { reorderShelfKeys } from "../lib/posShelfOrder";

/** Drag-to-reorder shelves using document pointermove + elementFromPoint (works on touch). */
export function useShelfDragReorder(orderKeys: string[], onReorder: (next: string[]) => void) {
  const orderKeysRef = useRef(orderKeys);
  orderKeysRef.current = orderKeys;
  const dragKeyRef = useRef<string | null>(null);
  const didMoveRef = useRef(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const applyReorder = useCallback(
    (activeKey: string, targetKey: string) => {
      if (activeKey === targetKey) return;
      const next = reorderShelfKeys(orderKeysRef.current, activeKey, targetKey);
      if (next.join("|") !== orderKeysRef.current.join("|")) {
        didMoveRef.current = true;
        onReorder(next);
      }
    },
    [onReorder],
  );

  const endDrag = useCallback(() => {
    dragKeyRef.current = null;
    setDragKey(null);
    setOverKey(null);
    window.setTimeout(() => {
      didMoveRef.current = false;
    }, 0);
  }, []);

  const startDrag = useCallback(
    (key: string, e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      didMoveRef.current = false;
      dragKeyRef.current = key;
      setDragKey(key);
      setOverKey(key);

      const onMove = (ev: PointerEvent) => {
        const active = dragKeyRef.current;
        if (!active) return;
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const host = el?.closest("[data-shelf-key]");
        const targetKey = host?.getAttribute("data-shelf-key");
        if (!targetKey || targetKey === active) return;
        setOverKey(targetKey);
        applyReorder(active, targetKey);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        endDrag();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [applyReorder, endDrag],
  );

  const shouldIgnoreClick = useCallback(() => didMoveRef.current, []);

  return { dragKey, overKey, startDrag, shouldIgnoreClick };
}
