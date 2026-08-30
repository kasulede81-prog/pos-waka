import clsx from "clsx";
import {
  UGX_CHECKOUT_COIN_DENOMINATIONS,
  UGX_CHECKOUT_NOTE_DENOMINATIONS,
  checkoutCoinAssetPath,
  checkoutNoteAssetPath,
  formatDenominationLabel,
} from "../../lib/cashDenominations";
import { publicAssetUrl } from "../../lib/publicAssetUrl";

type Props = {
  onAddNote: (ugx: number) => void;
  /**
   * `desktop` — catalog cash dock (fill height beside keypad).
   * `touch` — mobile/compact stacked workspace (touch targets, no fixed dock width).
   */
  density?: "desktop" | "touch";
};

/** Cash tender helper. Does not own tender state — parent mutates `cashInput`. */
export function CheckoutNotePicker({ onAddNote, density = "desktop" }: Props) {
  const touch = density === "touch";

  return (
    <div
      className={clsx(
        "flex min-w-0 flex-col gap-1.5",
        touch ? "w-full" : "min-h-0 flex-1",
      )}
      data-checkout-note-picker
      data-checkout-note-density={density}
      role="group"
      aria-label="Add Ugandan cash denominations"
    >
      <div
        className={clsx(
          "grid grid-cols-3 gap-1.5",
          touch ? "w-full" : "min-h-0 flex-1 grid-rows-2",
        )}
        data-checkout-note-grid
      >
        {UGX_CHECKOUT_NOTE_DENOMINATIONS.map((denom) => (
          <button
            key={denom}
            type="button"
            data-checkout-cash-note={denom}
            onClick={() => onAddNote(denom)}
            aria-label={`Add UGX ${formatDenominationLabel(denom)} cash note`}
            className={clsx(
              "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-muted/80 px-1 active:bg-waka-100",
              touch ? "min-h-[3.75rem] py-1.5" : "min-h-0 py-1",
            )}
          >
            <img
              src={publicAssetUrl(checkoutNoteAssetPath(denom))}
              alt=""
              draggable={false}
              className={clsx(
                "w-full object-contain",
                touch ? "h-11 max-h-14 shrink-0" : "h-full min-h-0 flex-1",
              )}
            />
            <span className="shrink-0 text-[10px] font-black leading-none tabular-nums text-foreground sm:text-[11px]">
              {formatDenominationLabel(denom)}
            </span>
          </button>
        ))}
      </div>
      <div className="grid shrink-0 grid-cols-3 gap-1.5" data-checkout-coin-row>
        {UGX_CHECKOUT_COIN_DENOMINATIONS.map((denom) => (
          <button
            key={denom}
            type="button"
            data-checkout-cash-coin={denom}
            onClick={() => onAddNote(denom)}
            aria-label={`Add UGX ${formatDenominationLabel(denom)} coin`}
            className={clsx(
              "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-muted/80 px-1 active:bg-waka-100",
              touch ? "min-h-[3.5rem] py-1.5" : "min-h-[3.25rem] py-1",
            )}
          >
            <img
              src={publicAssetUrl(checkoutCoinAssetPath(denom))}
              alt=""
              draggable={false}
              className={clsx(
                "shrink-0 rounded-full object-contain",
                touch ? "h-11 w-11" : "h-10 w-10 sm:h-12 sm:w-12",
              )}
            />
            <span className="shrink-0 text-[10px] font-black leading-none tabular-nums text-foreground sm:text-[11px]">
              {formatDenominationLabel(denom)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
