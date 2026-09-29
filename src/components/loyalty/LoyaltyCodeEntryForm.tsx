import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../lib/i18n";
import { useUiLanguage } from "../../hooks/useUiLanguage";
import {
  buildProgramJoinPath,
  isValidProgramCodeFormat,
  normalizeProgramCode,
} from "../../lib/loyalty/loyaltyPublicProgram";

/**
 * Phase 2C — the WAKA Loyalty entry point: "enter your merchant's code".
 *
 * WHY THIS REPLACES A REGISTRATION FORM. A WAKA Loyalty member only means something in relation to
 * a merchant's programme — the points, the card and the membership all belong to a shop. Creating
 * a `loyalty_members` row with no programme attached produced an identity with nothing to show and
 * no way to become useful, so the product no longer does it. The merchant's code is the required
 * context, and this is where it is collected.
 *
 * It CREATES NOTHING and AUTHENTICATES NOBODY. It validates the code's shape and navigates to
 * `/j/<code>` — the same page a scanned QR opens — which re-resolves the programme server-side,
 * offers Google, and performs the join. There is exactly one place a member is created, and this
 * is not it.
 *
 * Used by `/member/register` and by the member home for a signed-in person who is not a member, so
 * both surfaces offer the identical experience.
 */
export function LoyaltyCodeEntryForm({
  title,
  subtitle,
}: {
  title?: string;
  subtitle?: string;
}) {
  const { lang } = useUiLanguage();
  const navigate = useNavigate();
  const [codeInput, setCodeInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = normalizeProgramCode(codeInput);
    if (!isValidProgramCodeFormat(code)) {
      setError(t(lang, "loyaltyJoinNotFound"));
      return;
    }
    setError(null);
    // Navigation only — no RPC, no member, no session change.
    navigate(buildProgramJoinPath(code));
  };

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <div>
        <h2 className="text-base font-black text-foreground">
          {title ?? t(lang, "loyaltyProgramEnterCode")}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {subtitle ?? t(lang, "loyaltyProgramCodeSub")}
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          {t(lang, "loyaltyProgramCodeLabel")}
        </span>
        <input
          className="waka-input font-mono uppercase tracking-wider"
          value={codeInput}
          onChange={(e) => {
            setCodeInput(e.target.value);
            setError(null);
          }}
          placeholder={t(lang, "loyaltyProgramPlaceholder")}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          data-testid="loyalty-code-entry-input"
        />
      </label>

      {error ? (
        <p role="alert" className="text-xs font-semibold text-destructive" data-testid="loyalty-code-entry-error">
          {error}
        </p>
      ) : null}

      <button type="submit" className="waka-btn-primary w-full" data-testid="loyalty-code-entry-submit">
        {t(lang, "loyaltyProgramFind")}
      </button>
    </form>
  );
}

export default LoyaltyCodeEntryForm;
