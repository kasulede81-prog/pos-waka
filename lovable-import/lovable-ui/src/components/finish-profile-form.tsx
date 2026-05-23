import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { usePOS } from "@/lib/pos-store";
import { useProfile } from "@/lib/use-profile";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

/**
 * Inline form for the "Finish your business profile first" warning.
 * Saves locally + to the cloud profile, then dismisses itself.
 * Optionally navigates back via router history when done.
 */
export function FinishProfileForm({ returnTo }: { returnTo?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const profile = usePOS((s) => s.profile);
  const updateProfile = usePOS((s) => s.updateProfile);
  const { profile: cloudProfile, reload } = useProfile();

  const [shopName, setShopName] = useState(profile.shopName ?? "");
  const [ownerName, setOwnerName] = useState(profile.ownerName ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudProfile) return;
    if (cloudProfile.shop_name && !shopName) setShopName(cloudProfile.shop_name);
    if (cloudProfile.owner_name && !ownerName) setOwnerName(cloudProfile.owner_name);
    if (cloudProfile.phone && !phone) setPhone(cloudProfile.phone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudProfile?.id]);

  return (
    <div className="rounded-3xl border-2 border-waka-500/50 bg-waka-50 p-6">
      <h2 className="text-lg font-black text-waka-900">{t("profile.finish.title")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-waka-900/80">{t("profile.finish.body")}</p>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const sn = shopName.trim();
          const on = ownerName.trim();
          const ph = phone.trim();
          if (!sn || !ph) {
            setError("Shop name and phone are required.");
            return;
          }
          setSaving(true);
          updateProfile({ shopName: sn, ownerName: on, phone: ph });
          if (cloudProfile) {
            const { error: dbErr } = await supabase
              .from("profiles")
              .update({ shop_name: sn, owner_name: on || null, phone: ph })
              .eq("id", cloudProfile.id);
            if (dbErr) setError(dbErr.message);
            await reload();
          }
          setSaving(false);
          if (!error && returnTo) {
            router.navigate({ to: returnTo as never });
          }
        }}
        className="mt-4 grid gap-2 sm:grid-cols-2"
      >
        <input
          required
          value={shopName}
          onChange={(e) => setShopName(e.target.value)}
          placeholder={t("profile.finish.shop")}
          className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm sm:col-span-2"
        />
        <input
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          placeholder={t("profile.finish.owner")}
          className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
        />
        <input
          required
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t("profile.finish.phone")}
          className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
        />
        {error && (
          <p className="text-xs font-bold text-rose-600 sm:col-span-2">{error}</p>
        )}
        <button
          disabled={saving}
          className="rounded-full bg-waka-600 px-5 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60 sm:col-span-2"
        >
          {saving ? t("profile.finish.saving") : t("profile.finish.save")}
        </button>
      </form>
    </div>
  );
}
