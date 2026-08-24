import clsx from "clsx";
import type { Language, UserRole } from "../../types";
import { t } from "../../lib/i18n";
import type { SellerPickerOption } from "../../lib/staffSellerPicker";

type Props = {
  lang: Language;
  sellers: SellerPickerOption[];
  selectedStaffId: string | null;
  onSelect: (staffId: string) => void;
  /** Optional owner/operator row for lock-screen unlock without seller switch. */
  ownerOption?: { id: string; label: string } | null;
  emptyMessage?: string;
  className?: string;
};

function roleLabel(lang: Language, role: UserRole): string {
  return t(lang, `role_${role}`);
}

/** Presentational seller directory picker — no auth or PIN logic. */
export function SellerPicker({
  lang,
  sellers,
  selectedStaffId,
  onSelect,
  ownerOption = null,
  emptyMessage,
  className,
}: Props) {
  const empty = !ownerOption && sellers.length === 0;

  if (empty) {
    return (
      <p
        className={clsx("rounded-xl border border-border bg-muted/40 px-3 py-3 text-sm font-semibold text-muted-foreground", className)}
        data-testid="seller-picker-empty"
        role="status"
      >
        {emptyMessage ?? t(lang, "sellerPickerEmpty")}
      </p>
    );
  }

  return (
    <div className={clsx("space-y-2", className)} data-testid="seller-picker" role="listbox" aria-label={t(lang, "switchSeller")}>
      {ownerOption ? (
        <button
          type="button"
          role="option"
          aria-selected={selectedStaffId === ownerOption.id}
          onClick={() => onSelect(ownerOption.id)}
          className={clsx(
            "flex min-h-[56px] w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition",
            selectedStaffId === ownerOption.id
              ? "border-waka-500 bg-waka-50 shadow-sm dark:border-waka-400 dark:bg-waka-950/40"
              : "border-border bg-card active:bg-muted",
          )}
        >
          <span className="text-sm font-black text-foreground">{ownerOption.label}</span>
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "role_owner")}</span>
        </button>
      ) : null}

      {sellers.map((seller) => {
        const selected = selectedStaffId === seller.id;
        return (
          <button
            key={seller.id}
            type="button"
            role="option"
            aria-selected={selected}
            data-testid={`seller-picker-${seller.id}`}
            onClick={() => onSelect(seller.id)}
            className={clsx(
              "flex min-h-[56px] w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition",
              selected
                ? "border-waka-500 bg-waka-50 shadow-sm dark:border-waka-400 dark:bg-waka-950/40"
                : "border-border bg-card active:bg-muted",
            )}
          >
            <span className="text-sm font-black text-foreground">{seller.name}</span>
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {roleLabel(lang, seller.role)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
