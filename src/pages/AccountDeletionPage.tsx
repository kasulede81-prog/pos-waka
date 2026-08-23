import { useEffect, useId, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { User } from "@supabase/supabase-js";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { useSessionActor } from "../context/SessionActorContext";
import { authOperatorRole } from "../lib/sessionActor";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { usePosStore } from "../store/usePosStore";
import { hasSupabaseConfig } from "../lib/supabase";
import {
  clearOwnerDeletionPendingOnFailure,
  escalateOwnerDeletionPendingAfterPartialCloudSuccess,
  finalizeOwnerAccountDeletionLocally,
  markOwnerDeletionInProgress,
  ownerPermanentlyDeleteOwnAccount,
  retryOwnerAuthDeletion,
  type OwnerAccountDeletionResult,
} from "../lib/ownerAccountDeletion";
import { readOwnerDeletePartialFailure } from "../lib/ownerDeletePartialFailure";
import {
  hasRecentOwnerDeleteReauth,
  reauthenticateOwnerWithGoogle,
  reauthenticateOwnerWithPassword,
  userRequiresPasswordReauth,
  userSupportsOAuthReauth,
} from "../lib/ownerDeleteReauth";
import {
  EMPTY_OWNER_DELETION_BLAST_RADIUS,
  loadOwnerDeletionBlastRadius,
  matchesOwnerDeletionConfirmText,
  type OwnerDeletionBlastRadius,
} from "../lib/ownerDeletionBlastRadius";
import { buildSelfDeleteHealthSnapshot, ownerDeleteReadinessFromSnapshot } from "../lib/selfDeleteHealth";
import { looksLikeInternalDeletionLeak } from "../lib/ownerDeletionErrors";
import { WakaCheckbox } from "../components/enterprise/WakaCheckbox";

type Props = {
  lang: Language;
  userId: string | null;
  email: string | null | undefined;
  user: User | null;
  onSignOut: () => Promise<void>;
};

function ownerDeletionErrorCopy(lang: Language, result: OwnerAccountDeletionResult): string {
  if (result.partial || result.errorCode === "partial") return t(lang, "accountDeletionPartialMessage");
  if (result.errorCode === "reauth_required") return t(lang, "accountDeletionReauthIdentity");
  if (result.errorCode === "validation") return t(lang, "accountDeletionConfirmHint");
  return t(lang, "accountDeletionUnavailable");
}

function safeUiError(lang: Language, raw: string | null | undefined, fallbackKey: "accountDeletionReauthIdentity" | "accountDeletionUnavailable"): string {
  if (!raw || looksLikeInternalDeletionLeak(raw)) return t(lang, fallbackKey);
  return raw;
}

export function AccountDeletionPage({ lang, userId, email, user, onSignOut }: Props) {
  const actor = useSessionActor();
  const navigate = useNavigate();
  const shopName = usePosStore((s) => s.preferences.shopDisplayName?.trim() || "");
  const confirmId = useId();
  const passwordId = useId();
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendReady, setBackendReady] = useState<boolean | null>(null);
  const [partialFailure, setPartialFailure] = useState(readOwnerDeletePartialFailure());
  const [reauthOk, setReauthOk] = useState(hasRecentOwnerDeleteReauth());
  const [blast, setBlast] = useState<OwnerDeletionBlastRadius>(EMPTY_OWNER_DELETION_BLAST_RADIUS);

  const needsPassword = userRequiresPasswordReauth(user);
  const canUseGoogle = userSupportsOAuthReauth(user);

  useEffect(() => {
    let cancelled = false;
    void buildSelfDeleteHealthSnapshot({ isOwner: authOperatorRole(actor) === "owner", user }).then((snap) => {
      if (!cancelled) {
        setBackendReady(ownerDeleteReadinessFromSnapshot(snap) === "ready");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [actor.role, user]);

  useEffect(() => {
    let cancelled = false;
    void loadOwnerDeletionBlastRadius(userId).then((next) => {
      if (!cancelled) setBlast(next);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (authOperatorRole(actor) !== "owner") {
    return <Navigate to="/office/account" replace />;
  }

  if (!hasSupabaseConfig) {
    return <Navigate to="/office/account" replace />;
  }

  const finishSuccess = async () => {
    setSigningOut(true);
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
        setError(t(lang, "accountDeletionReauthIdentity"));
        setReauthOk(false);
        return false;
      }
      setReauthOk(true);
      setError(null);
      return true;
    }
    setError(t(lang, "accountDeletionReauthIdentity"));
    setReauthOk(false);
    return false;
  };

  const runGoogleReauth = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await reauthenticateOwnerWithGoogle();
      if (!r.ok) {
        setError(t(lang, "accountDeletionReauthIdentity"));
        setReauthOk(false);
        return;
      }
      setReauthOk(true);
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async () => {
    if (busy || signingOut) return;
    setError(null);
    if (!ack) {
      setError(t(lang, "accountDeletionAckRequired"));
      return;
    }
    const typed = confirmText.trim();
    const orgConfirm = blast.organizationName?.trim() || "";
    if (!matchesOwnerDeletionConfirmText(typed, { organizationName: orgConfirm })) {
      setError(t(lang, "accountDeletionConfirmHint"));
      return;
    }
    if (
      !window.confirm(
        orgConfirm
          ? t(lang, "accountDeletionFinalConfirm").replace("{{org}}", orgConfirm)
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
      escalateOwnerDeletionPendingAfterPartialCloudSuccess(userId);
      setPartialFailure(readOwnerDeletePartialFailure());
    } else {
      clearOwnerDeletionPendingOnFailure();
    }
    setError(ownerDeletionErrorCopy(lang, result));
  };

  const runRetryAuth = async () => {
    if (busy || signingOut) return;
    setError(null);
    if (!(await verifyIdentity())) return;

    setBusy(true);
    const result = await retryOwnerAuthDeletion(user);
    if (result.ok) {
      await finishSuccess();
      return;
    }
    setBusy(false);
    setError(ownerDeletionErrorCopy(lang, result));
  };

  const hasBlastCounts = blast.organizationId != null && blast.shopCount != null;
  const orgLabel = blast.organizationName || null;

  if (signingOut) {
    return (
      <div className="space-y-5 pb-8" aria-live="polite" aria-busy="true">
        <SettingsPageHeader
          lang={lang}
          title={t(lang, "accountDeletionTitle")}
          subtitle={t(lang, "accountDeletionSub")}
          backTo="/office/account"
          backLabel={t(lang, "officeBackToHub")}
        />
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950" role="status">
          {t(lang, "accountDeletionSigningOut")}
        </p>
      </div>
    );
  }

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

        <article className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4" role="alert">
          <p className="text-sm font-bold text-amber-950">{t(lang, "accountDeletionPartialMessage")}</p>
          {partialFailure.shopName ? (
            <p className="mt-2 text-sm font-semibold text-amber-900">
              {t(lang, "shopHeading")}: {partialFailure.shopName}
            </p>
          ) : null}
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm font-semibold text-amber-900">
            <li>{t(lang, "accountDeletionPartialItemCloud")}</li>
            <li>{t(lang, "accountDeletionPartialItemLogin")}</li>
            <li>{t(lang, "accountDeletionPartialItemSupport")}</li>
          </ul>
        </article>

        {needsPassword ? (
          <label htmlFor={passwordId} className="block text-sm font-bold text-foreground">
            {t(lang, "accountDeletionPasswordLabel")}
            <input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 min-h-[44px] w-full rounded-xl border-2 border-border px-4 py-3 text-base font-semibold"
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
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-950" role="alert">
            {safeUiError(lang, error, "accountDeletionUnavailable")}
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy || (!reauthOk && needsPassword && !password)}
          onClick={() => void runRetryAuth()}
          aria-busy={busy}
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

      {backendReady === false ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950" role="status">
          {t(lang, "accountDeletionBackendNotReady")}
        </p>
      ) : null}

      <article
        className="rounded-2xl border-2 border-rose-300 bg-rose-50 p-4"
        aria-labelledby="account-deletion-blast-title"
      >
        <p id="account-deletion-blast-title" className="text-[10px] font-black uppercase tracking-wide text-rose-800">
          {t(lang, "accountDeletionDanger")}
        </p>
        <h2 className="mt-2 text-base font-black text-rose-950">{t(lang, "accountDeletionBlastTitle")}</h2>
        <p className="mt-2 text-sm font-medium leading-relaxed text-rose-950">{t(lang, "accountDeletionBody")}</p>
        <p className="mt-2 text-sm font-black text-rose-950">{t(lang, "accountDeletionCannotUndo")}</p>

        {hasBlastCounts ? (
          <dl className="mt-3 space-y-1.5 text-sm font-semibold text-rose-900">
            <div className="flex flex-wrap justify-between gap-2">
              <dt>{t(lang, "accountDeletionBlastOrg")}</dt>
              <dd className="font-black text-rose-950">{orgLabel || shopName || "—"}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>{t(lang, "accountDeletionBlastShops")}</dt>
              <dd className="font-black tabular-nums text-rose-950">{blast.shopCount}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt>{t(lang, "accountDeletionBlastStaff")}</dt>
              <dd className="font-black tabular-nums text-rose-950">
                {blast.staffAuthCount == null ? "—" : blast.staffAuthCount}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-sm font-semibold text-rose-900">{t(lang, "accountDeletionBlastUnavailable")}</p>
        )}

        <p className="mt-3 text-sm font-black text-rose-950">{t(lang, "accountDeletionWhatDeleted")}</p>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm font-semibold text-rose-900">
          <li>{t(lang, "accountDeletionItemShops")}</li>
          <li>{t(lang, "accountDeletionItemProducts")}</li>
          <li>{t(lang, "accountDeletionItemSales")}</li>
          <li>{t(lang, "accountDeletionItemStaff")}</li>
          <li>{t(lang, "accountDeletionItemCloud")}</li>
        </ul>
        <p className="mt-3 text-xs font-semibold text-rose-800">{t(lang, "accountDeletionBillingNote")}</p>
      </article>

      <WakaCheckbox
        id="account-deletion-ack"
        checked={ack}
        onCheckedChange={setAck}
        label={t(lang, "accountDeletionAck")}
        className="min-h-[44px] text-sm font-semibold text-foreground"
      />

      <label htmlFor={confirmId} className="block text-sm font-bold text-foreground">
        {t(lang, "accountDeletionTypeLabel")}
        <input
          id={confirmId}
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mt-2 min-h-[44px] w-full rounded-xl border-2 border-border px-4 py-3 text-base font-semibold"
          autoComplete="off"
          placeholder="DELETE PERMANENTLY"
          aria-describedby="account-deletion-confirm-hint"
        />
      </label>
      <p id="account-deletion-confirm-hint" className="text-xs font-medium text-muted-foreground">
        {t(lang, "accountDeletionConfirmHint")}
      </p>

      {needsPassword ? (
        <label htmlFor={`${passwordId}-main`} className="block text-sm font-bold text-foreground">
          {t(lang, "accountDeletionPasswordLabel")}
          <input
            id={`${passwordId}-main`}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 min-h-[44px] w-full rounded-xl border-2 border-border px-4 py-3 text-base font-semibold"
          />
          <span className="mt-1 block text-xs font-medium text-muted-foreground">
            {t(lang, "accountDeletionPasswordHint")}
          </span>
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
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-950" role="alert">
          {safeUiError(lang, error, "accountDeletionUnavailable")}
        </p>
      ) : null}

      {busy ? (
        <p className="text-sm font-semibold text-muted-foreground" role="status" aria-live="polite">
          {t(lang, "accountDeletionBusy")}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy || backendReady === false}
        onClick={() => void runDelete()}
        aria-busy={busy}
        className="min-h-[52px] w-full rounded-2xl bg-rose-700 py-3 text-lg font-black text-white disabled:opacity-50"
      >
        {busy ? t(lang, "accountDeletionBusy") : t(lang, "accountDeletionSubmit")}
      </button>
    </div>
  );
}
