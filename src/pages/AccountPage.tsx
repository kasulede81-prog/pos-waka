import { Link } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import type { Language } from "../types";
import { hasSupabaseConfig } from "../lib/supabase";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { AccountSubscriptionCenter } from "../components/subscription/AccountSubscriptionCenter";

type Props = {
  lang: Language;
  email: string | null | undefined;
  shopName?: string | null;
  onSignOut: () => Promise<void>;
  user: User | null;
  authMode: "supabase" | "local";
};

export function AccountPage({ lang, email, shopName, onSignOut, user, authMode }: Props) {
  const actor = useSessionActor();

  const displayName =
    String((user?.user_metadata as Record<string, unknown> | undefined)?.full_name ?? "").trim() ||
    (email ? email.split("@")[0] : "—");

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "officeCardAccount")}
        subtitle={t(lang, "officeCardAccountSub")}
        backTo="/office"
        backLabel={t(lang, "officeBackToHub")}
      />

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(lang, "accountSignedIn")}</p>
        <p className="mt-1 text-lg font-black text-foreground">{displayName}</p>
        {email ? <p className="mt-0.5 text-sm font-semibold text-muted-foreground">{email}</p> : null}
        {shopName ? (
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="font-bold">{t(lang, "shopHeading")}:</span> {shopName}
          </p>
        ) : null}
        <p className="mt-2 text-sm text-muted-foreground">
          {t(lang, "loggedInAs")}: {t(lang, `role_${actor.role}`)}
        </p>
      </article>

      {authMode === "supabase" ? <AccountSubscriptionCenter lang={lang} /> : null}

      <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-sm font-semibold text-muted-foreground">
          {hasSupabaseConfig ? t(lang, "settingsAccountOnline") : t(lang, "settingsAccountOffline")}
        </p>
      </article>

      {hasSupabaseConfig && actor.role === "owner" ? (
        <article className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 shadow-sm">
          <p className="text-sm font-semibold text-rose-950">{t(lang, "accountDeletionCardHint")}</p>
          <Link
            to="/office/account/delete"
            className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-rose-300 bg-card px-4 text-sm font-black text-rose-800"
          >
            {t(lang, "userMenuDeleteAccount")} →
          </Link>
        </article>
      ) : null}

      <button
        type="button"
        onClick={() => onSignOut()}
        className="min-h-[52px] w-full rounded-2xl bg-rose-600 py-3 text-lg font-black text-white"
      >
        {t(lang, "logoutFromSettings")}
      </button>
    </div>
  );
}
