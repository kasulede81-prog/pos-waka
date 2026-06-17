import clsx from "clsx";

/** Real spacer at end of Sell page so the last row clears nav + optional checkout strip. */
export function PosPageScrollSpacer({ minimizedCheckout }: { minimizedCheckout: boolean }) {
  return (
    <div
      aria-hidden
      className={clsx(
        "pointer-events-none shrink-0",
        minimizedCheckout
          ? "h-[calc(var(--waka-bottom-nav-h)+var(--waka-pos-checkout-strip-h)+var(--waka-safe-bottom)+0.25rem)] lg:h-3"
          : "h-1 lg:h-3",
      )}
    />
  );
}
