import { useEffect, useState } from "react";
import { visualViewportKeyboardGap } from "../lib/safeAreaInsets";

/** Extra bottom inset when the on-screen keyboard shrinks the visual viewport (mobile browsers). */
export function useVisualViewportInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      setInset(visualViewportKeyboardGap(window.innerHeight, vv.height, vv.offsetTop));
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return inset;
}
