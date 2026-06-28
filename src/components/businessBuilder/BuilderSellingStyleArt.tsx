import type { ShopSellingStyle } from "../../types";

type Props = { style: ShopSellingStyle };

/** Mini SVG for selling-style cards — no emoji. */
export function BuilderSellingStyleArt({ style }: Props) {
  return (
    <svg viewBox="0 0 64 48" className="h-12 w-16 shrink-0" aria-hidden>
      {style === "piece" ? (
        <g>
          <rect x="20" y="12" width="24" height="28" rx="4" fill="#fed7aa" stroke="#fb923c" />
          <rect x="26" y="18" width="12" height="8" rx="1" fill="#fff" />
        </g>
      ) : null}
      {style === "carton" ? (
        <g>
          <rect x="12" y="20" width="20" height="16" rx="2" fill="#c4a574" stroke="#a16207" />
          <rect x="32" y="16" width="20" height="20" rx="2" fill="#d6b88a" stroke="#a16207" />
        </g>
      ) : null}
      {style === "sack" ? (
        <g>
          <ellipse cx="32" cy="36" rx="22" ry="6" fill="rgba(0,0,0,0.1)" />
          <path d="M18 20 Q32 8 46 20 L42 38 Q32 44 22 38 Z" fill="#d97706" />
        </g>
      ) : null}
      {style === "mixed" ? (
        <g>
          <rect x="10" y="22" width="16" height="14" rx="2" fill="#c4a574" />
          <rect x="28" y="14" width="12" height="22" rx="2" fill="#fed7aa" stroke="#fb923c" />
          <circle cx="48" cy="28" r="10" fill="#22c55e" opacity="0.8" />
        </g>
      ) : null}
    </svg>
  );
}
