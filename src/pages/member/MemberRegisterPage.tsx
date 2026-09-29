import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { WakaPosLogo } from "../../components/brand/WakaLogo";
import { signUpLoyaltyMember } from "../../lib/memberSignup";
import { isLoyaltySurface, posOrigin } from "../../lib/productHost";

/**
 * Phase 2B — the public entry point for someone who is not a WAKA user yet.
 *
 * PUBLIC BY DESIGN. It sits outside `ProtectedRoute`, because requiring a login to reach member
 * signup would be circular — before this page the only signup surface was the merchant
 * `/register`, which writes merchant metadata and bootstraps an owner workspace, so a person who
 * only wanted a loyalty card had no way in.
 *
 * This page collects the AUTH account only. Name and phone are captured afterwards, at `/member`,
 * by the member registration form — so identity data has exactly one home, and a half-finished
 * signup never leaves a stray member row behind.
 *
 * Styling follows the member surface's existing convention (see `WelcomePage`/`MemberHomePage`),
 * which is plain English and the shared `waka-input` / `waka-btn-primary` classes.
 */
export function MemberRegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await signUpLoyaltyMember({ email, password });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    if (result.needsEmailVerification) {
      navigate("/verify-email", { replace: true, state: { email: email.trim().toLowerCase() } });
      return;
    }
    // Already signed in — the member registration form is the next step, not the merchant wizard.
    navigate("/member", { replace: true });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <WakaPosLogo size="md" className="h-14" />
        <h1 className="text-2xl font-black tracking-tight text-foreground">Join WAKA Loyalty</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Create an account to collect points at the shops you already visit and keep your loyalty
          cards in one place.
        </p>
      </header>

      <form className="flex flex-col gap-3" onSubmit={submit}>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Email
          </span>
          <input
            className="waka-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
            required
            disabled={busy}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Password
          </span>
          <input
            className="waka-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            required
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
          {busy ? "Creating your account…" : "Create my Loyalty account"}
        </button>
      </form>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        This creates a customer Loyalty account only. It does not create a shop or a business
        account.
      </p>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="waka-link">
          Sign in
        </Link>
      </p>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Want to run a shop instead?{" "}
        {/* Merchant signup is a POS route. On the loyalty host it is not part of the customer app
            and would be redirected away, so the cross-surface link is absolute there. */}
        {isLoyaltySurface() ? (
          <a href={`${posOrigin()}/register`} className="waka-link">
            Set up a business
          </a>
        ) : (
          <Link to="/register" className="waka-link">
            Set up a business
          </Link>
        )}
      </p>
    </div>
  );
}

export default MemberRegisterPage;
