import { useEffect, useState } from "react";
import { visualViewportKeyboardGap } from "../lib/safeAreaInsets";

export type VisualViewportBounds = {
  offsetTop: number;
  offsetLeft: number;
  height: number;
  width: number;
  keyboardGap: number;
};

function readVisualViewportBounds(): VisualViewportBounds {
  const layoutH = window.innerHeight;
  const layoutW = window.innerWidth;
  const vv = window.visualViewport;
  if (!vv) {
    return { offsetTop: 0, offsetLeft: 0, height: layoutH, width: layoutW, keyboardGap: 0 };
  }
  return {
    offsetTop: vv.offsetTop,
    offsetLeft: vv.offsetLeft,
    height: vv.height,
    width: vv.width,
    keyboardGap: visualViewportKeyboardGap(layoutH, vv.height, vv.offsetTop),
  };
}

function boundsEqual(a: VisualViewportBounds, b: VisualViewportBounds): boolean {
  return (
    a.offsetTop === b.offsetTop &&
    a.offsetLeft === b.offsetLeft &&
    a.height === b.height &&
    a.width === b.width
  );
}

/** Tracks the visible viewport — used to pin modals above the on-screen keyboard. */
export function useVisualViewportBounds(): VisualViewportBounds {
  const [bounds, setBounds] = useState(readVisualViewportBounds);

  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const next = readVisualViewportBounds();
      setBounds((prev) => (boundsEqual(prev, next) ? prev : next));
    };

    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return bounds;
}
