import { useEffect, useRef } from "react";
import Lottie, { type LottieRefCurrentProps } from "lottie-react";
import clsx from "clsx";

/** Minimal confetti burst — lazy-loaded for grand opening only. */
export function BuilderConfetti({ className }: { className?: string }) {
  const lottieRef = useRef<LottieRefCurrentProps | null>(null);

  useEffect(() => {
    const anim = lottieRef.current;
    if (!anim) return;
    anim.setSpeed(0.9);
    anim.play();
  }, []);

  const data = {
    v: "5.7.4",
    fr: 30,
    ip: 0,
    op: 60,
    w: 400,
    h: 400,
    nm: "confetti",
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: "particles",
        sr: 1,
        ks: {
          o: { a: 0, k: 100 },
          r: { a: 0, k: 0 },
          p: { a: 0, k: [200, 200, 0] },
          a: { a: 0, k: [0, 0, 0] },
          s: { a: 0, k: [100, 100, 100] },
        },
        ao: 0,
        shapes: [
          {
            ty: "gr",
            it: [
              {
                ty: "rc",
                p: { a: 0, k: [0, 0] },
                s: { a: 0, k: [8, 8] },
                r: { a: 0, k: 2 },
                nm: "sq",
              },
              {
                ty: "fl",
                c: { a: 0, k: [0.98, 0.45, 0.09, 1] },
                o: { a: 0, k: 100 },
                nm: "fill",
              },
              {
                ty: "tr",
                p: {
                  a: 1,
                  k: [
                    { t: 0, s: [-80, -60], i: { x: 0.5, y: 1 }, o: { x: 0.5, y: 0 } },
                    { t: 60, s: [-40, 120] },
                  ],
                },
                a: { a: 0, k: [0, 0] },
                s: { a: 0, k: [100, 100] },
                r: { a: 1, k: [{ t: 0, s: [0] }, { t: 60, s: [180] }] },
                o: { a: 1, k: [{ t: 0, s: [100] }, { t: 60, s: [0] }] },
                sk: { a: 0, k: 0 },
                sa: { a: 0, k: 0 },
              },
            ],
            nm: "p1",
          },
          {
            ty: "gr",
            it: [
              {
                ty: "el",
                p: { a: 0, k: [0, 0] },
                s: { a: 0, k: [10, 10] },
                nm: "el",
              },
              {
                ty: "fl",
                c: { a: 0, k: [0.13, 0.77, 0.37, 1] },
                o: { a: 0, k: 100 },
                nm: "fill",
              },
              {
                ty: "tr",
                p: {
                  a: 1,
                  k: [
                    { t: 0, s: [60, -80], i: { x: 0.5, y: 1 }, o: { x: 0.5, y: 0 } },
                    { t: 60, s: [20, 100] },
                  ],
                },
                a: { a: 0, k: [0, 0] },
                s: { a: 0, k: [100, 100] },
                r: { a: 0, k: 0 },
                o: { a: 1, k: [{ t: 0, s: [100] }, { t: 60, s: [0] }] },
                sk: { a: 0, k: 0 },
                sa: { a: 0, k: 0 },
              },
            ],
            nm: "p2",
          },
        ],
        ip: 0,
        op: 60,
        st: 0,
        bm: 0,
      },
    ],
  };

  return (
    <div className={clsx("builder-confetti", className)} aria-hidden>
      <Lottie lottieRef={lottieRef} animationData={data} loop={false} className="h-full w-full" />
    </div>
  );
}
