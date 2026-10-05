import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { NameParts } from "../../lib/nameReview";

/**
 * The DKASU name step — the two fields a first-time Google user fills in.
 *
 * EXTRACTED FROM `StartBusinessPage`, NOT REIMPLEMENTED. It was inline there, which would have made
 * the staff invitation the second place this markup lives; the staff page now renders this same
 * component, so the two surfaces cannot drift in copy, validation wiring, test ids or
 * accessibility.
 *
 * The DECISION to show it stays where it was: `needsNameReview()` in `lib/nameReview.ts`. The WRITE
 * stays `confirmWakaName()` in `lib/wakaName.ts`, which records `waka_full_name` — a key no
 * provider touches — and is the reason a raw Google name can never become a DKASU name.
 *
 * The email is deliberately absent: it is the verified Google identity, and it is not editable
 * here or anywhere else in this flow.
 */
type Props = {
  lang: Language;
  parts: NameParts;
  onPartsChange: (next: NameParts) => void;
  /** Already localised, matching the merchant page's own state shape. */
  error: { field: "firstName" | "lastName"; message: string } | null;
  onClearError: () => void;
  disabled?: boolean;
  /** The extracted-from-Google explanation. Shown with the fields on both surfaces. */
  showProviderHint?: boolean;
};

export function NameReviewFields({
  lang,
  parts,
  onPartsChange,
  error,
  onClearError,
  disabled = false,
  showProviderHint = true,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      {showProviderHint ? (
        <p className="text-xs font-medium text-muted-foreground">{t(lang, "nameReviewFromGoogleHint")}</p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {t(lang, "nameReviewFirstNameLabel")} *
        </span>
        <input
          className="waka-input"
          value={parts.firstName}
          onChange={(e) => {
            onPartsChange({ ...parts, firstName: e.target.value });
            onClearError();
          }}
          autoComplete="given-name"
          maxLength={120}
          required
          disabled={disabled}
          aria-invalid={error?.field === "firstName" || undefined}
          data-testid="name-review-first-name"
        />
        {error?.field === "firstName" ? (
          <span role="alert" className="text-xs font-semibold text-destructive">
            {error.message}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {t(lang, "nameReviewLastNameLabel")} *
        </span>
        <input
          className="waka-input"
          value={parts.lastName}
          onChange={(e) => {
            onPartsChange({ ...parts, lastName: e.target.value });
            onClearError();
          }}
          autoComplete="family-name"
          maxLength={120}
          required
          disabled={disabled}
          aria-invalid={error?.field === "lastName" || undefined}
          data-testid="name-review-last-name"
        />
        {error?.field === "lastName" ? (
          <span role="alert" className="text-xs font-semibold text-destructive">
            {error.message}
          </span>
        ) : null}
      </label>
    </div>
  );
}
