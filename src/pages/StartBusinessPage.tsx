import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { WakaPosLogo } from "../components/brand/WakaLogo";
import { declareMerchantIntent } from "../lib/merchantIntent";
import { resolveAccountIdentity } from "../lib/memberIdentity";
import { supabase } from "../lib/supabase";

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
 * Reached only from `/welcome`, which is inside `ProtectedRoute`, so the visitor is authenticated.
 * A member session can still reach it by URL — which is harmless, because declaring merchant intent
 * grants no tenancy, and `resolveFromIdentity` checks an existing tenancy BEFORE merchant intent,
 * so a member who does this cannot displace or gain a workspace.
 */
export function StartBusinessPage() {
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
        const resolution = await resolveAccountIdentity({
          userId: user.id,
          metadata: user.user_metadata as Record<string, unknown> | undefined,
        });
        if (!cancelled) setGate(resolution.kind === "member" ? "member" : "allowed");
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await declareMerchantIntent({ shopName, ownerName });
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
        <h1 className="text-2xl font-black tracking-tight text-foreground">Set up your business</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Tell us what your shop is called. You will set up the rest in the next step.
        </p>
      </header>

      <form className="flex flex-col gap-3" onSubmit={submit}>
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
