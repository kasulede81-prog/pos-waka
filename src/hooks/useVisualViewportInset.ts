import { useEffect, useState } from "react";
import { visualViewportKeyboardGap } from "../lib/safeAreaInsets";

/** Ignore small viewport deltas from page scroll; real keyboards shrink height by much more. */
const KEYBOARD_OPEN_THRESHOLD_PX = 80;

/** Extra bottom inset when the on-screen keyboard shrinks the visual viewport (mobile browsers). */
export function useVisualViewportInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const gap = visualViewportKeyboardGap(window.innerHeight, vv.height, vv.offsetTop);
      setInset((prev) => {
        if (gap < KEYBOARD_OPEN_THRESHOLD_PX) {
          return prev > 0 ? 0 : prev;
        }
        return gap !== prev ? gap : prev;
      });
    };

    update();
    vv.addEventListener("resize", update);
    window.addEventListener("resize", update);

    return () => {
      vv.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return inset;
}
