import { useId } from "react";
import clsx from "clsx";
import type { HomeTileIntensity } from "../../lib/homeExecutiveKpis";
import type { HomeDrawerVisualState } from "../../lib/homeLivingMotion";

type Props = {
  state?: HomeDrawerVisualState;
  intensity?: HomeTileIntensity;
  className?: string;
  onOpenSettled?: () => void;
};

/**
 * Local SVG cash drawer — idle breath, hover peek, real-kick open.
 * Presentation only. Does not send ESC/POS.
 */
export function HomeCashDrawerScene({
  state = "idle",
  intensity = "calm",
  className,
  onOpenSettled,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const full = intensity === "high";

  return (
    <svg
      viewBox="0 0 88 58"
      className={clsx("home-cash-drawer-scene", className)}
      data-home-drawer={state}
      aria-hidden
      onAnimationEnd={(event) => {
        const name = event.animationName;
        if (name === "home-drawer-open" || name === "home-drawer-failed") {
          onOpenSettled?.();
        }
      }}
    >
      <defs>
        <linearGradient id={`hd-housing-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#78716c" />
          <stop offset="38%" stopColor="#44403c" />
          <stop offset="100%" stopColor="#1c1917" />
        </linearGradient>
        <linearGradient id={`hd-lid-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a8a29e" />
          <stop offset="100%" stopColor="#57534e" />
        </linearGradient>
        <linearGradient id={`hd-face-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a8a29e" />
          <stop offset="100%" stopColor="#44403c" />
        </linearGradient>
        <linearGradient id={`hd-tray-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#292524" />
          <stop offset="100%" stopColor="#0c0a09" />
        </linearGradient>
        <linearGradient id={`hd-bill-g-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86efac" />
          <stop offset="100%" stopColor="#15803d" />
        </linearGradient>
        <linearGradient id={`hd-bill-y-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
        <linearGradient id={`hd-bill-b-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#93c5fd" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <radialGradient id={`hd-well-${uid}`} cx="50%" cy="12%" r="78%">
          <stop offset="0%" stopColor="#57534e" />
          <stop offset="100%" stopColor="#1c1917" />
        </radialGradient>
        <linearGradient id={`hd-shine-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <ellipse className="home-drawer-shadow" cx="44" cy="54.5" rx="33" ry="3.4" fill="rgba(15,23,42,0.34)" />

      <g className="home-drawer-housing">
        <path d="M12 8 L76 8 L80 14 L8 14 Z" fill={`url(#hd-lid-${uid})`} />
        <rect x="8" y="13" width="72" height="30" rx="5" fill={`url(#hd-housing-${uid})`} stroke="#0c0a09" strokeWidth="1.1" />
        <rect x="11" y="16" width="66" height="12" rx="2" fill={`url(#hd-well-${uid})`} />
        <rect x="11" y="16" width="66" height="4" rx="2" fill={`url(#hd-shine-${uid})`} />
        <rect x="14" y="18" width="13" height="4.5" rx="1" fill="#1c1917" />
        <rect x="29" y="18" width="9" height="4.5" rx="1" fill="#1c1917" />
        <rect x="40" y="18" width="9" height="4.5" rx="1" fill="#1c1917" />
        <circle className="home-drawer-led" cx="72" cy="20.2" r="2.2" fill="#4ade80" />
        <circle cx="72" cy="20.2" r="3.4" fill="#4ade80" opacity="0.18" />
      </g>

      <g className="home-drawer-tray">
        <rect x="13" y="24" width="62" height="24" rx="3.2" fill={`url(#hd-tray-${uid})`} stroke="#0c0a09" strokeWidth="1" />
        <rect x="15" y="26" width="58" height="13" rx="2" fill="#141210" />
        <g className="home-drawer-bills">
          <rect x="17" y="27.5" width="12" height="10" rx="1.1" fill={`url(#hd-bill-g-${uid})`} />
          <rect x="31" y="27" width="12" height="10.5" rx="1.1" fill={`url(#hd-bill-y-${uid})`} />
          <rect x="45" y="27.5" width="12" height="10" rx="1.1" fill={`url(#hd-bill-b-${uid})`} />
          {full ? <rect x="59" y="27" width="11" height="10.5" rx="1.1" fill={`url(#hd-bill-g-${uid})`} opacity="0.9" /> : null}
          <rect x="18" y="28" width="10" height="1.2" rx="0.4" fill="#ecfdf5" opacity="0.35" />
          <rect x="32" y="27.6" width="10" height="1.2" rx="0.4" fill="#fffbeb" opacity="0.4" />
        </g>
        <ellipse cx="22" cy="40.5" rx="3.2" ry="1.5" fill="#d6d3d1" />
        <ellipse cx="30" cy="40.5" rx="3.2" ry="1.5" fill="#fbbf24" />
        <rect className="home-drawer-face" x="13" y="39" width="62" height="9" rx="2" fill={`url(#hd-face-${uid})`} />
        <rect x="13" y="39" width="62" height="2.4" fill={`url(#hd-shine-${uid})`} />
        <rect className="home-drawer-handle" x="36" y="41.4" width="16" height="3.4" rx="1.5" fill="#e7e5e4" />
      </g>
    </svg>
  );
}
