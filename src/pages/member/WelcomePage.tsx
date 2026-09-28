import { Link } from "react-router-dom";
import { WakaPosLogo } from "../../components/brand/WakaLogo";

/**
 * Phase 1 — the landing page for an authenticated session that is not (yet) anything.
 *
 * Before this page existed, an authenticated user with no membership and no merchant signup was
 * silently provisioned a brand-new organization, shop, trial subscription and owner role by the
 * owner bootstrap. They are now deliberately classified `unknown` and sent here instead, so the
 * decision to become a merchant is one a person makes rather than one that happens to them.
 *
 * This page CREATES NOTHING. It does not call bootstrap_owner_workspace, does not touch
 * organization/shop/subscription/profiles/shop_members, and does not set the workspace-bootstrapped
 * flag. Both destinations below are ordinary navigations into flows that already exist.
 */
export function WelcomePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <WakaPosLogo size="md" className="h-14" />
        <h1 className="text-2xl font-black tracking-tight text-foreground">Welcome to WAKA</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your account is ready. Choose how you want to use it.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <Link
          to="/register"
          className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-waka-400"
        >
          <span className="text-base font-black text-foreground">Set up a business</span>
          <span className="text-sm leading-relaxed text-muted-foreground">
            Run WAKA POS for a shop — sales, stock, staff and reports.
          </span>
        </Link>

        <Link
          to="/member"
          className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-waka-400"
        >
          <span className="text-base font-black text-foreground">Join WAKA Loyalty</span>
          <span className="text-sm leading-relaxed text-muted-foreground">
            Collect points at the shops you already visit, and keep your loyalty cards in one
            place.
          </span>
        </Link>
      </div>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        Nothing has been created yet — you can choose either, or neither.
      </p>
    </div>
  );
}

export default WelcomePage;
