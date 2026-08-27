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
};

/** Desktop/full catalog cash workspace. Does not own tender state. */
export function CheckoutNotePicker({ onAddNote }: Props) {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5"
      data-checkout-note-picker
      role="group"
      aria-label="Add Ugandan cash denominations"
    >
      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-1.5" data-checkout-note-grid>
        {UGX_CHECKOUT_NOTE_DENOMINATIONS.map((denom) => (
          <button
            key={denom}
            type="button"
            data-checkout-cash-note={denom}
            onClick={() => onAddNote(denom)}
            aria-label={`Add UGX ${formatDenominationLabel(denom)} cash note`}
            className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-muted/80 px-1 py-1 active:bg-waka-100"
          >
            <img
              src={publicAssetUrl(checkoutNoteAssetPath(denom))}
              alt=""
              draggable={false}
              className="h-full min-h-0 w-full flex-1 object-contain"
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
            className="flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-muted/80 px-1 py-1 active:bg-waka-100"
          >
            <img
              src={publicAssetUrl(checkoutCoinAssetPath(denom))}
              alt=""
              draggable={false}
              className="h-10 w-10 shrink-0 rounded-full object-contain sm:h-12 sm:w-12"
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
