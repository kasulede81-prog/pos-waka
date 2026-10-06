import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
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
 *
 * Phase A — customer-facing copy runs through the shared i18n dictionaries (en/lg/sw) and the
 * branding is DKASU.
 */
export function WelcomePage({ lang }: { lang: Language }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <WakaPosLogo size="md" className="h-14" />
        <h1 className="text-2xl font-black tracking-tight text-foreground">
          {t(lang, "welcomeTitle")}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t(lang, "welcomeBody")}</p>
      </header>

      <div className="flex flex-col gap-3">
        {/* Phase 2C — goes to the intent step, NOT /register. /register forwards an authenticated
            session to /onboarding, which the identity gate bounces straight back here, so this link
            used to be a loop for anyone without merchant metadata (e.g. a Google signup). */}
        <Link
          to="/start-business"
          data-testid="welcome-start-business"
          className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-waka-400"
        >
          <span className="text-base font-black text-foreground">
            {t(lang, "welcomeBusinessTitle")}
          </span>
          <span className="text-sm leading-relaxed text-muted-foreground">
            {t(lang, "welcomeBusinessBody")}
          </span>
        </Link>

        <Link
          to="/member"
          className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-waka-400"
        >
          <span className="text-base font-black text-foreground">{t(lang, "memberJoinTitle")}</span>
          <span className="text-sm leading-relaxed text-muted-foreground">
            {t(lang, "welcomeLoyaltyBody")}
          </span>
        </Link>
      </div>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        {t(lang, "welcomeFootnote")}
      </p>
    </div>
  );
}

export default WelcomePage;
