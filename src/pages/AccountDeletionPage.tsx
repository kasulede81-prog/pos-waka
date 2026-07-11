import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { HardDeleteReportPanel } from "../components/settings/HardDeleteReportPanel";
import { SelfDeleteHealthPanel } from "../components/settings/SelfDeleteHealthPanel";
import { usePosStore } from "../store/usePosStore";
import { hasSupabaseConfig } from "../lib/supabase";
import {
  finalizeOwnerAccountDeletionLocally,
  markOwnerDeletionInProgress,
  ownerPermanentlyDeleteOwnAccount,
  retryOwnerAuthDeletion,
} from "../lib/ownerAccountDeletion";
import { readOwnerDeletePartialFailure } from "../lib/ownerDeletePartialFailure";
import {
  hasRecentOwnerDeleteReauth,
  reauthenticateOwnerWithGoogle,
  reauthenticateOwnerWithPassword,
  userRequiresPasswordReauth,
  userSupportsOAuthReauth,
} from "../lib/ownerDeleteReauth";
import { buildSelfDeleteHealthSnapshot } from "../lib/selfDeleteHealth";
import { WakaCheckbox } from "../components/enterprise/WakaCheckbox";

type Props = {
  lang: Language;
  userId: string | null;
  email: string | null | undefined;
  user: User | null;
  onSignOut: () => Promise<void>;
};

export function AccountDeletionPage({ lang, userId, email, user, onSignOut }: Props) {
  const actor = useSessionActor();
  const navigate = useNavigate();
  const shopName = usePosStore((s) => s.preferences.shopDisplayName?.trim() || "");
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendReady, setBackendReady] = useState<boolean | null>(null);
  const [partialFailure, setPartialFailure] = useState(readOwnerDeletePartialFailure());
  const [reauthOk, setReauthOk] = useState(hasRecentOwnerDeleteReauth());

  const needsPassword = userRequiresPasswordReauth(user);
  const canUseGoogle = userSupportsOAuthReauth(user);

  useEffect(() => {
    let cancelled = false;
    void buildSelfDeleteHealthSnapshot({ isOwner: actor.role === "owner", user }).then((snap) => {
      if (!cancelled) {
        setBackendReady(snap.rpcStatus === "ok" && snap.edgeStatus === "ok");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [actor.role, user]);

  if (actor.role !== "owner") {
    return <Navigate to="/office/account" replace />;
  }

  if (!hasSupabaseConfig) {
    return <Navigate to="/office/account" replace />;
  }

  const finishSuccess = async () => {
    await finalizeOwnerAccountDeletionLocally(userId);
    await onSignOut().catch(() => undefined);
    navigate("/login", { replace: true });
  };

  const verifyIdentity = async (): Promise<boolean> => {
    if (hasRecentOwnerDeleteReauth()) {
      setReauthOk(true);
      return true;
    }
    if (needsPassword) {
      const r = await reauthenticateOwnerWithPassword(email ?? "", password);
      if (!r.ok) {
        setError(r.message);
        setReauthOk(false);
        return false;
      }
      setReauthOk(true);
      setError(null);
      return true;
    }
    setError(t(lang, "accountDeletionReauthRequired"));
    setReauthOk(false);
    return false;
  };

  const runGoogleReauth = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await reauthenticateOwnerWithGoogle();
      if (!r.ok) {
        setError(r.message);
        setReauthOk(false);
        return;
      }
      setReauthOk(true);
    } finally {
      setBusy(false);
    }
  };

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

    if (!(await verifyIdentity())) return;

    setBusy(true);
    markOwnerDeletionInProgress(userId);
    const result = await ownerPermanentlyDeleteOwnAccount(typed, user);
    if (result.ok) {
      await finishSuccess();
      return;
    }

    setBusy(false);
    if (result.partial) {
      setPartialFailure(readOwnerDeletePartialFailure());
    }
    setError(result.message ?? t(lang, "accountDeletionFailed"));
  };

  const runRetryAuth = async () => {
    setError(null);
    if (!(await verifyIdentity())) return;

    setBusy(true);
    const result = await retryOwnerAuthDeletion(user);
    if (result.ok) {
      await finishSuccess();
      return;
    }
    setBusy(false);
    setError(result.message ?? t(lang, "accountDeletionPartialRetryFailed"));
  };

  if (partialFailure) {
    return (
      <div className="space-y-5 pb-8">
        <SettingsPageHeader
          lang={lang}
          title={t(lang, "accountDeletionPartialTitle")}
          subtitle={t(lang, "accountDeletionPartialSub")}
          backTo="/office/account"
          backLabel={t(lang, "officeBackToHub")}
        />

        <article className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 shadow-sm">
          <p className="text-sm font-bold text-amber-950">{t(lang, "accountDeletionPartialBody")}</p>
          {partialFailure.shopName ? (
            <p className="mt-2 text-sm font-semibold text-amber-900">
              {t(lang, "shopHeading")}: {partialFailure.shopName}
            </p>
          ) : null}
          {partialFailure.message ? (
            <p className="mt-2 text-xs font-medium text-amber-900">{partialFailure.message}</p>
          ) : null}
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm font-semibold text-amber-900">
            <li>{t(lang, "accountDeletionPartialItemCloud")}</li>
            <li>{t(lang, "accountDeletionPartialItemLogin")}</li>
            <li>{t(lang, "accountDeletionPartialItemSupport")}</li>
          </ul>
        </article>

        {partialFailure.deletionReport ? (
          <HardDeleteReportPanel lang={lang} report={partialFailure.deletionReport} />
        ) : null}

        {needsPassword ? (
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "accountDeletionPasswordLabel")}
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-xl border-2 border-border px-4 py-3 text-base font-semibold"
            />
          </label>
        ) : null}

        {canUseGoogle ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void runGoogleReauth()}
            className="min-h-[48px] w-full rounded-2xl border-2 border-border bg-card py-3 text-sm font-black text-foreground disabled:opacity-50"
          >
            {t(lang, "accountDeletionGoogleReauth")}
          </button>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-950">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy || (!reauthOk && needsPassword && !password)}
          onClick={() => void runRetryAuth()}
          className="min-h-[52px] w-full rounded-2xl bg-amber-700 py-3 text-lg font-black text-white disabled:opacity-50"
        >
          {busy ? t(lang, "accountDeletionPartialRetryBusy") : t(lang, "accountDeletionPartialRetry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <SettingsPageHeader
        lang={lang}
        title={t(lang, "accountDeletionTitle")}
        subtitle={t(lang, "accountDeletionSub")}
        backTo="/office/account"
        backLabel={t(lang, "officeBackToHub")}
      />

      <SelfDeleteHealthPanel lang={lang} user={user} />

      {backendReady === false ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
          {t(lang, "accountDeletionBackendNotReady")}
        </p>
      ) : null}

      <article className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-wide text-rose-800">{t(lang, "accountDeletionDanger")}</p>
        <p className="mt-2 text-sm font-medium leading-relaxed text-rose-950">{t(lang, "accountDeletionBody")}</p>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm font-semibold text-rose-900">
          <li>{t(lang, "accountDeletionItemSales")}</li>
          <li>{t(lang, "accountDeletionItemProducts")}</li>
          <li>{t(lang, "accountDeletionItemCustomers")}</li>
          <li>{t(lang, "accountDeletionItemCloud")}</li>
          <li>{t(lang, "accountDeletionItemLogin")}</li>
          <li>{t(lang, "accountDeletionItemDevices")}</li>
        </ul>
        <p className="mt-3 text-xs font-semibold text-rose-800">{t(lang, "accountDeletionReuseHint")}</p>
      </article>

      <WakaCheckbox
        checked={ack}
        onCheckedChange={setAck}
        label={t(lang, "accountDeletionAck")}
        className="text-sm font-semibold text-foreground"
      />

      <label className="block text-sm font-bold text-foreground">
        {t(lang, "accountDeletionTypeLabel")}
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mt-2 w-full rounded-xl border-2 border-border px-4 py-3 text-base font-semibold"
          autoComplete="off"
          placeholder={shopName ? shopName : "DELETE PERMANENTLY"}
        />
      </label>

      {needsPassword ? (
        <label className="block text-sm font-bold text-foreground">
          {t(lang, "accountDeletionPasswordLabel")}
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full rounded-xl border-2 border-border px-4 py-3 text-base font-semibold"
          />
          <span className="mt-1 block text-xs font-medium text-muted-foreground">{t(lang, "accountDeletionPasswordHint")}</span>
        </label>
      ) : null}

      {canUseGoogle ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void runGoogleReauth()}
          className="min-h-[48px] w-full rounded-2xl border-2 border-border bg-card py-3 text-sm font-black text-foreground disabled:opacity-50"
        >
          {reauthOk ? t(lang, "accountDeletionGoogleReauthOk") : t(lang, "accountDeletionGoogleReauth")}
        </button>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-950">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy || backendReady === false}
        onClick={() => void runDelete()}
        className="min-h-[52px] w-full rounded-2xl bg-rose-700 py-3 text-lg font-black text-white disabled:opacity-50"
      >
        {busy ? t(lang, "accountDeletionBusy") : t(lang, "accountDeletionSubmit")}
      </button>
    </div>
  );
}
