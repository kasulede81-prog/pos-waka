import type { SVGProps } from "react";

/** Square POS mark — use `className="h-9 w-9 shrink-0 text-waka-600"` */
export function WakaMarkIcon(props: SVGProps<SVGSVGElement>) {
  const { className = "", ...rest } = props;
  return (
    <svg viewBox="0 0 48 48" role="img" aria-hidden className={className} {...rest}>
      <rect width="48" height="48" rx="12" fill="currentColor" />
      {/* receipt teeth */}
      <path
        fill="#fff"
        d="M14 8h20v6H14V8zm2 1.5h2.2v3H16v-3zm3.4 0h2.2v3h-2.2v-3zm3.4 0h2.2v3h-2.2v-3zm3.3 0h2.2v3h-2.2v-3zm3.4 0h2.2v3h-2.2v-3zm3.4 0H34v3h-2.2v-3z"
      />
      {/* screen */}
      <rect x="11" y="16" width="26" height="22" rx="3" fill="#fff" />
      {/* subtle W */}
      <path
        fill="currentColor"
        fillOpacity={0.2}
        d="M16 34V22h3l2.2 7.5L23.5 22h1L28 29.5 30 22h3v12h-2.8v-8.2L26.5 34h-1.8l-3.6-8.3V34H16z"
      />
      {/* keypad */}
      <g fill="#ea580c" fillOpacity={0.55}>
        <rect x="15" y="36" width="3.5" height="3.5" rx="0.7" />
        <rect x="20.5" y="36" width="3.5" height="3.5" rx="0.7" />
        <rect x="26" y="36" width="3.5" height="3.5" rx="0.7" />
        <rect x="31.5" y="36" width="3.5" height="3.5" rx="0.7" />
      </g>
    </svg>
  );
}
