import type { SVGProps } from "react";

/** Orange W with cart motif — Waka Technologies mark */
export function WakaMarkIcon(props: SVGProps<SVGSVGElement>) {
  const { className = "", ...rest } = props;
  return (
    <svg viewBox="0 0 48 48" role="img" aria-label="Waka Technologies logo" className={className} {...rest}>
      <rect width="48" height="48" rx="12" fill="currentColor" />
      <path
        fill="#fff"
        d="M8 32V14h5.5l4 11.5L21.5 14h4l4 11.5L34 14h5.5v18h-6V24.5L25.5 32h-3.6l-7.4-11V32H8z"
      />
      <path fill="#fff" d="M30 32h10v2.2H30V32z" />
      <circle fill="#fff" cx="33" cy="36.5" r="1.6" />
      <circle fill="#fff" cx="37" cy="36.5" r="1.6" />
    </svg>
  );
}

type WordmarkProps = SVGProps<SVGSVGElement> & { showProduct?: boolean };

/** Full wordmark for marketing header */
export function WakaBrandWordmark({ className = "", showProduct = true }: WordmarkProps) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-2.5 ${className}`}>
      <WakaMarkIcon className="h-11 w-11 shrink-0 text-orange-600 shadow-md" />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-base font-black text-orange-600">Waka</span>
        <span className="block truncate text-sm font-black text-stone-800">Technologies</span>
        {showProduct ? (
          <span className="block truncate text-[10px] font-bold uppercase tracking-wide text-stone-500">Waka POS</span>
        ) : null}
      </span>
    </span>
  );
}
