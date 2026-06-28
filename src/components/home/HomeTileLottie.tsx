import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { LottieRefCurrentProps } from "lottie-react";
import { fetchHomeTileLottie } from "../../lib/homeTileLottieCache";
import { runWhenIdle } from "../../lib/uiYield";
import { HomeTileLottieBoundary } from "./HomeTileLottieBoundary";

const LottiePlayer = lazy(() => import("lottie-react"));

type Props = {
  tileId: string;
  active: boolean;
  className?: string;
};

/** Lottie accent — only loads and plays while this tile is in the spotlight. */
export function HomeTileLottie({ tileId, active, className }: Props) {
  const [data, setData] = useState<object | null>(null);
  const [mountPlayer, setMountPlayer] = useState(false);
  const lottieRef = useRef<LottieRefCurrentProps | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void fetchHomeTileLottie(tileId).then((json) => {
      if (!cancelled) setData(json);
    });
    return () => {
      cancelled = true;
    };
  }, [tileId, active]);

  useEffect(() => {
    if (!data || !active) {
      setMountPlayer(false);
      return;
    }
    let cancelled = false;
    runWhenIdle(() => {
      if (!cancelled) setMountPlayer(true);
    });
    return () => {
      cancelled = true;
    };
  }, [data, active]);

  useEffect(() => {
    if (!active || !mountPlayer) {
      try {
        lottieRef.current?.pause();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const anim = lottieRef.current;
      if (!anim) return;
      anim.stop();
      anim.setSpeed(1);
      anim.play();
    } catch {
      /* ignore */
    }
  }, [active, mountPlayer, tileId]);

  if (!active || !data || !mountPlayer) return null;

  return (
    <HomeTileLottieBoundary>
      <Suspense fallback={null}>
        <LottiePlayer
          lottieRef={lottieRef}
          animationData={data}
          loop={false}
          autoplay={false}
          className={className}
          rendererSettings={{ preserveAspectRatio: "xMidYMid meet", progressiveLoad: true }}
          style={{ willChange: "transform", pointerEvents: "none" }}
        />
      </Suspense>
    </HomeTileLottieBoundary>
  );
}

export function prefetchHomeTileLotties(tileIds: string[]): void {
  for (const id of tileIds) void fetchHomeTileLottie(id);
}
