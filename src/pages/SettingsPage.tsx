import type { Language } from "../types";
import { hasSupabaseConfig } from "../lib/supabase";
import { t } from "../lib/i18n";

type Props = {
  lang: Language;
  email: string | null | undefined;
  shopName?: string | null;
  onSignOut: () => Promise<void>;
};

export function SettingsPage({ lang, email, shopName, onSignOut }: Props) {
  return (
    <div className="space-y-4 pb-24 md:pb-4">
      <h2 className="text-xl font-semibold">{t(lang, "settings")}</h2>

      <article className="rounded-xl border bg-white p-4">
        <p className="font-medium">{t(lang, "accountHeading")}</p>
        <p className="mt-2 text-sm text-slate-600">
          <span className="font-semibold">{t(lang, "loggedInAs")}:</span> {email ?? "—"}
        </p>
        {shopName ? (
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-semibold">{t(lang, "shopHeading")}:</span> {shopName}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-slate-500">{t(lang, "sessionHelp")}</p>
        <button
          type="button"
          onClick={() => onSignOut()}
          className="mt-4 w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white"
        >
          {t(lang, "logoutFromSettings")}
        </button>
      </article>

      <article className="rounded-xl border bg-white p-4">
        <p className="font-medium">Integration</p>
        <p className="text-sm text-slate-600">{hasSupabaseConfig ? "Supabase URL + anon key detected" : t(lang, "supabaseMissing")}</p>
      </article>

      <article className="rounded-xl border bg-white p-4">
        <p className="font-medium">Business profile</p>
        <p className="text-sm text-slate-600">Uganda-focused defaults for kiosk, pharmacy, salon, restaurant, vendor, hardware.</p>
      </article>
    </div>
  );
}
