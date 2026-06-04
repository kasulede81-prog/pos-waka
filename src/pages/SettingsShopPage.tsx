import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { hasPermission } from "../lib/permissions";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { ShopProfileForm } from "../components/settings/ShopProfileForm";
import { PrimaryShopSelector } from "../components/settings/PrimaryShopSelector";
import { ShopSupportNumberCard } from "../components/settings/ShopSupportNumberCard";
import { SupportQuickStrip } from "../components/trust/SupportQuickStrip";

type Props = {
  lang: Language;
  email: string | null | undefined;
  shopName?: string | null;
  user: User | null;
  authMode: "supabase" | "local";
};

export function SettingsShopPage({ lang, email, shopName, user, authMode }: Props) {
  const actor = useSessionActor();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const showOnboardGate = searchParams.get("onboard") === "1";

  if (!hasPermission(actor.role, "settings.shop")) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="space-y-4 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "shopProfilePageTitle")}
        subtitle={t(lang, "shopProfilePageSubtitle")}
      />
      <PrimaryShopSelector lang={lang} authMode={authMode} />
      <ShopProfileForm
        lang={lang}
        authMode={authMode}
        user={user}
        email={email}
        shopName={shopName}
        showOnboardGate={showOnboardGate}
        onSaved={() => navigate(showOnboardGate ? "/" : "/settings/shop", { replace: true })}
      />
      <ShopSupportNumberCard lang={lang} />
      <SupportQuickStrip lang={lang} />
    </div>
  );
}
