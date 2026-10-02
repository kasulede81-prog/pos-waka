import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { WakaPosLogo } from "../../components/brand/WakaLogo";
import { LoyaltyCodeEntryForm } from "../../components/loyalty/LoyaltyCodeEntryForm";
import { fetchMemberDashboard } from "../../lib/memberDashboard";
import { posOrigin } from "../../lib/productHost";

/**
 * Phase 2C — "Join DKASU Loyalty": the merchant code step.
 *
 * PUBLIC BY DESIGN, and it still is: a person who is not a DKASU user at all can open this page,
 * type the code from the poster in the shop, and be carried into the join. Requiring a login to
 * reach loyalty signup would be circular.
 *
 * THIS PAGE CREATES NOTHING — no account, no member, no membership, no session. That is a change
 * from Phase 2B, which used this route to create an auth account and then relied on `/member` to
 * create the member row. Both halves of that are gone: a member is now created only by the
 * explicit join on `/j/<code>`, with the merchant's programme as the required context.
 *
 * The code is not a password or a credential. It is a public merchant identifier, and naming it
 * grants nothing — the destination page re-resolves it server-side before anything happens.
 */
export function MemberRegisterPage() {
  // Signed-in people who already belong to a programme go straight to their dashboard rather than
  // being asked for a code they do not need. A non-member, or a visitor with no session, sees the
  // code step. `not_a_member`/`not_authenticated` are the only failures that mean "not a member";
  // anything else (offline) falls back to showing the form, which creates nothing either way.
  const [alreadyMember, setAlreadyMember] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetchMemberDashboard();
      if (!cancelled && r.ok) setAlreadyMember(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (alreadyMember) return <Navigate to="/member" replace />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <WakaPosLogo size="md" className="h-14" />
        <h1 className="text-2xl font-black tracking-tight text-foreground">Join WAKA Loyalty</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Collect points at the shops you already visit and keep your loyalty cards in one place.
        </p>
      </header>

      <section className="rounded-2xl border border-border/80 bg-card p-5" data-testid="member-register-code-entry">
        <LoyaltyCodeEntryForm />
      </section>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        This creates nothing on its own. You will see the shop, then choose how to sign in.
      </p>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="waka-link">
          Sign in
        </Link>
      </p>

      {/* Cross-surface link. Absolute on purpose: this page is only ever rendered on
          loyalty.waka.ug, where a relative `/register` is not part of the customer app. */}
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Want to run a shop instead?{" "}
        <a href={`${posOrigin()}/register`} className="waka-link">
          Set up a business
        </a>
      </p>
    </div>
  );
}

export default MemberRegisterPage;
