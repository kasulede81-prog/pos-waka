import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { usePosStore } from "../store/usePosStore";
import { hasSupabaseConfig } from "../lib/supabase";
import {
  finalizeOwnerAccountDeletionLocally,
  ownerPermanentlyDeleteOwnAccount,
} from "../lib/ownerAccountDeletion";

type Props = {
  lang: Language;
  userId: string | null;
  onSignOut: () => Promise<void>;
};

export function AccountDeletionPage({ lang, userId, onSignOut }: Props) {
  const actor = useSessionActor();
  const navigate = useNavigate();
  const shopName = usePosStore((s) => s.preferences.shopDisplayName?.trim() || "");
  const [confirmText, setConfirmText] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (actor.role !== "owner") {
    return <Navigate to="/office/account" replace />;
  }

  if (!hasSupabaseConfig) {
    return <Navigate to="/office/account" replace />;
  }

  const runDelete = async () => {
    setError(null);
    if (!ack) {
      setError(t(lang, "accountDeletionAckRequired"));
      return;
    }
    const typed = confirmText.trim();
    const shopConfirm = shopName.trim();
    if (typed !== "DELETE PERMANENTLY" && typed.toUpperCase() !== shopConfirm.toUpperCase()) {
      setError(t(lang, "accountDeletionConfirmHint"));
      return;
    }
    if (
      !window.confirm(
        shopConfirm
          ? t(lang, "accountDeletionFinalConfirm").replace("{{shop}}", shopConfirm)
          : t(lang, "accountDeletionFinalConfirmGeneric"),
      )
    ) {
      return;
    }

    setBusy(true);
    const result = await ownerPermanentlyDeleteOwnAccount(typed);
    if (result.ok) {
      await finalizeOwnerAccountDeletionLocally(userId);
      await onSignOut().catch(() => undefined);
      navigate("/login", { replace: true });
      return;
    }

    setBusy(false);
    setError(result.message ?? t(lang, "accountDeletionFailed"));
  };

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "accountDeletionTitle")}
        subtitle={t(lang, "accountDeletionSub")}
        backTo="/office/account"
        backLabel={t(lang, "officeBackToHub")}
      />

      <article className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-wide text-rose-800">{t(lang, "accountDeletionDanger")}</p>
        <p className="mt-2 text-sm font-medium leading-relaxed text-rose-950">{t(lang, "accountDeletionBody")}</p>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm font-semibold text-rose-900">
          <li>{t(lang, "accountDeletionItemSales")}</li>
          <li>{t(lang, "accountDeletionItemProducts")}</li>
          <li>{t(lang, "accountDeletionItemCustomers")}</li>
          <li>{t(lang, "accountDeletionItemCloud")}</li>
          <li>{t(lang, "accountDeletionItemLogin")}</li>
        </ul>
        <p className="mt-3 text-xs font-semibold text-rose-800">{t(lang, "accountDeletionReuseHint")}</p>
      </article>

      <label className="flex items-start gap-2 text-sm font-semibold text-stone-800">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          className="mt-1 h-4 w-4"
        />
        {t(lang, "accountDeletionAck")}
      </label>

      <label className="block text-sm font-bold text-stone-900">
        {t(lang, "accountDeletionTypeLabel")}
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mt-2 w-full rounded-xl border-2 border-stone-200 px-4 py-3 text-base font-semibold"
          autoComplete="off"
          placeholder={shopName ? shopName : "DELETE PERMANENTLY"}
        />
      </label>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-950">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={() => void runDelete()}
        className="min-h-[52px] w-full rounded-2xl bg-rose-700 py-3 text-lg font-black text-white disabled:opacity-50"
      >
        {busy ? t(lang, "accountDeletionBusy") : t(lang, "accountDeletionSubmit")}
      </button>
    </div>
  );
}
