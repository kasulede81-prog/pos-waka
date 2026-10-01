import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { declareMerchantIntent } from "../lib/merchantIntent";
import { confirmWakaName } from "../lib/wakaName";
import {
  composeFullName,
  namePartsProblem,
  needsNameReview,
  normalizeNamePart,
  reviewPrefill,
  type NameParts,
} from "../lib/nameReview";
import { resolveAccountIdentity } from "../lib/memberIdentity";
import { t } from "../lib/i18n";
import type { Language } from "../types";
import { supabase } from "../lib/supabase";

type Props = { lang: Language };

/**
 * Phase 2C — explicit merchant intent for a session that is not yet anything.
 *
 * Sits between `/welcome` ("Set up a business") and `/onboarding`, OUTSIDE `KnownIdentityGate`.
 * That placement is the whole point: the gate only admits a session the Phase 1 classifier already
 * calls `merchant`, so a brand-new Google user — who carries no merchant metadata — was previously
 * bounced from `/onboarding` straight back to `/welcome`, an endless loop with no way to sign up.
 *
 * This page is the one place that closes that loop, and it does it by declaring intent the same way
 * the email signup always has: metadata only. It creates nothing. The workspace is still created by
 * the existing guarded bootstrap, once the person has actually completed the onboarding wizard.
 *
 * NAME REVIEW (added). Google's name is a suggestion from an external identity provider; WAKA's
 * name is a thing the person chose, and the two used to be the same string — a provider rename on a
 * later login could replace a name the merchant had already picked. So a FIRST-TIME merchant is
 * asked to confirm their name here, before their first tenancy exists. The declaration is written
 * with the same metadata merge this page already performs (`confirmWakaName`), and the review is
 * never shown to a loyalty member or to anyone who already has a tenancy or a confirmed name —
 * `needsNameReview` owns that decision, and it is a pure function so it can be tested directly.
 *
 * Reached only from `/welcome`, which is inside `ProtectedRoute`, so the visitor is authenticated.
 * A member session can still reach it by URL — which is harmless, because declaring merchant intent
 * grants no tenancy, and `resolveFromIdentity` checks an existing tenancy BEFORE merchant intent,
 * so a member who does this cannot displace or gain a workspace.
 */
export function StartBusinessPage({ lang }: Props) {
  const navigate = useNavigate();
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A registered WAKA Loyalty member already has a product surface; sending them into merchant
   * onboarding would offer them a second, unrelated one.
   *
   * THIS IS NOT AN AUTHORIZATION CHECK. It only decides which screen a member is shown — it grants
   * nothing and blocks nothing. Whether a workspace may be created is still decided server-side by
   * `waka_account_identity()` through `resolveAccountIdentity` / `blocksOwnerBootstrap`, which is
   * exactly why this redirect can be bypassed without consequence: a member who reached the form
   * anyway would write metadata and then be refused a tenancy by the guarded bootstrap, because
   * `resolveFromIdentity` checks the member row BEFORE merchant intent.
   *
   * `merchant` is allowed through (declaring or re-declaring intent is harmless and the identity
   * gate admits them regardless); `unknown` is the case this page exists for.
   */
  const [gate, setGate] = useState<"checking" | "member" | "allowed">("checking");

  /** The review's own state. `metadata` is the session's, used to decide and to pre-fill. */
  const [metadata, setMetadata] = useState<Record<string, unknown> | null>(null);
  const [hasTenancy, setHasTenancy] = useState(false);
  const [identityKind, setIdentityKind] = useState<"merchant" | "member" | "unknown">("unknown");
  const [parts, setParts] = useState<NameParts>({ firstName: "", lastName: "" });
  const [partError, setPartError] = useState<{ field: "firstName" | "lastName"; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!supabase) {
        if (!cancelled) setGate("allowed");
        return;
      }
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        // No session means ProtectedRoute owns the redirect; do not guess here.
        if (!user) {
          if (!cancelled) setGate("allowed");
          return;
        }
        const meta = user.user_metadata as Record<string, unknown> | undefined;
        const resolution = await resolveAccountIdentity({
          userId: user.id,
          metadata: meta,
        });
        if (cancelled) return;
        setMetadata((meta ?? null) as Record<string, unknown> | null);
        setIdentityKind(resolution.kind);
        // A tenancy is an existing WAKA identity; that person is never asked to re-confirm. The
        // `member` variant carries no `reason` (membership is decided by the member row), and a
        // member is redirected below regardless — so only merchant/unknown are read here.
        const reason = resolution.kind === "member" ? null : resolution.reason;
        setHasTenancy(reason === "existing_tenancy" || reason === "pending_staff_invite");
        setParts(reviewPrefill(meta));
        setGate(resolution.kind === "member" ? "member" : "allowed");
      } catch {
        // Classifier unreachable: fall through to the form rather than trapping the user. Nothing
        // is granted by showing it — the bootstrap is still gated server-side.
        if (!cancelled) setGate("allowed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate === "member") return <Navigate to="/member" replace />;

  // Hold the form back until the classification is known, so a member never sees it flash.
  if (gate === "checking") {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-5">
        <p className="text-sm font-medium text-muted-foreground">Loading…</p>
      </div>
    );
  }

  // One decision, read by the header, the fields and the submit alike, so the screen and the write
  // can never disagree about whether this person is reviewing a name.
  const reviewing = needsNameReview({ kind: identityKind, hasTenancy, metadata });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const confirmedName = composeFullName(parts.firstName, parts.lastName);

    if (reviewing) {
      const problem = namePartsProblem(parts);
      if (problem) {
        setPartError({
          field: problem.field,
          message: t(lang, problem.messageKey),
        });
        return;
      }
    }

    setBusy(true);
    setError(null);
    setPartError(null);

    // The confirmed name is persisted BEFORE the intent declaration, and the intent merge preserves
    // it (it spreads the current metadata). Doing it in this order means a failure here leaves the
    // account exactly as it was, rather than intent-declared with an unconfirmed name.
    if (reviewing) {
      const confirmed = await confirmWakaName({ fullName: confirmedName });
      if (!confirmed.ok) {
        setError("We could not save your name. Please try again.");
        setBusy(false);
        return;
      }
    }

    // The reviewed name IS the owner name when the review ran; otherwise the optional field stands.
    const intentOwnerName = reviewing ? confirmedName : normalizeNamePart(ownerName);

    const result = await declareMerchantIntent({ shopName, ownerName: intentOwnerName });
    if (!result.ok) {
      setError(
        result.error === "invalid_shop_name"
          ? "Enter your shop's name."
          : "We could not save that. Please try again.",
      );
      setBusy(false);
      return;
    }

    // Navigation only. The shop, the organization and the owner membership are created by the
    // guarded bootstrap when the onboarding wizard is completed — never here.
    navigate("/onboarding", { replace: true });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <WakaPosLogo size="md" className="h-14" />
        <h1 className="text-2xl font-black tracking-tight">
          {reviewing ? t(lang, "nameReviewTitle") : "Set up your business"}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {reviewing
            ? t(lang, "nameReviewSub")
            : "Tell us what your shop is called. You will set up the rest in the next step."}
        </p>
      </header>

      {/*
        `noValidate` on purpose. `required` stays on the fields for their semantics and the `*`, but
        the browser's own bubble would intercept submission before `submit` runs — and this screen
        must answer with the message it puts BESIDE the field, in the person's language, rather than
        a native tooltip. The same handler already validates the shop name.
      */}
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        {reviewing ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t(lang, "nameReviewFromGoogleHint")}
            </p>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {t(lang, "nameReviewFirstNameLabel")} *
              </span>
              <input
                className="waka-input"
                value={parts.firstName}
                onChange={(e) => {
                  setParts((p) => ({ ...p, firstName: e.target.value }));
                  setPartError(null);
                }}
                autoComplete="given-name"
                maxLength={120}
                required
                disabled={busy}
                aria-invalid={partError?.field === "firstName" || undefined}
                data-testid="name-review-first-name"
              />
              {partError?.field === "firstName" ? (
                <span role="alert" className="text-xs font-semibold text-destructive">
                  {partError.message}
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
                  setParts((p) => ({ ...p, lastName: e.target.value }));
                  setPartError(null);
                }}
                autoComplete="family-name"
                maxLength={120}
                required
                disabled={busy}
                aria-invalid={partError?.field === "lastName" || undefined}
                data-testid="name-review-last-name"
              />
              {partError?.field === "lastName" ? (
                <span role="alert" className="text-xs font-semibold text-destructive">
                  {partError.message}
                </span>
              ) : null}
            </label>
          </div>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Shop name
          </span>
          <input
            className="waka-input"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="e.g. Cathy Beauty Shop"
            maxLength={80}
            autoComplete="organization"
            required
            disabled={busy}
            data-testid="start-business-shop-name"
          />
        </label>

        {!reviewing ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Your name (optional)
            </span>
            <input
              className="waka-input"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="e.g. Cathy Nakato"
              maxLength={120}
              autoComplete="name"
              disabled={busy}
            />
          </label>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
          >
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={busy} className="waka-btn-primary mt-1 w-full">
          {busy ? "Saving…" : "Continue"}
        </button>
      </form>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Nothing has been created yet — you can still{" "}
        <Link to="/welcome" className="waka-link">
          choose something else
        </Link>
        .
      </p>
    </div>
  );
}

export default StartBusinessPage;
