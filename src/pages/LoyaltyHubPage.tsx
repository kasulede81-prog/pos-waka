import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useSessionActor } from "../context/SessionActorContext";
import { resolveShopCtx } from "../offline/cloudSync";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";
import { WakaButton, WakaInput } from "../components/ui/wakaPrimitives";
import { EnterpriseEmptyState } from "../components/enterprise/EnterpriseEmptyState";
import { EnterpriseErrorState } from "../components/enterprise/EnterpriseErrorState";
import {
  EnterpriseSkeleton,
  EnterpriseSkeletonList,
} from "../components/enterprise/EnterpriseSkeleton";
import { UserSearch } from "lucide-react";
import { ConfirmationDialog } from "../components/layout/ConfirmationDialog";
import {
  balanceAfterRedeem,
  pointsStillNeeded,
  redeemErrorMessage,
} from "../lib/loyalty/loyaltyRedeemConfirm";
import { LoyaltyShell } from "../components/loyalty/LoyaltyShell";
import {
  loyaltySectionPath,
  resolveLoyaltySection,
  type LoyaltySectionId,
} from "../lib/loyalty/loyaltyNav";
import {
  adjustLoyaltyPoints,
  fetchAccountHistory,
  fetchLoyaltyAccountQrToken,
  fetchLoyaltyOverview,
  renewLoyaltyMembership,
  saveLoyaltyProgram,
  searchLoyaltyAccounts,
  setLoyaltyAccountLifecycle,
  validateProgramInput,
  type LoyaltyAccountListEntry,
  type LoyaltyOverview,
  type ProgramInput,
} from "../lib/loyalty/loyaltyMerchant";
import type { LoyaltyTransactionRow, MembershipExpiryMode } from "../lib/loyalty/loyaltyMath";
import { computeEarnedPoints, DEFAULT_LOYALTY_PROGRAM } from "../lib/loyalty/loyaltyMath";
import { LoyaltyEnrollmentPanel } from "../components/loyalty/LoyaltyEnrollmentPanel";
import { LoyaltyMemberQr } from "../components/loyalty/LoyaltyMemberQr";
import { LoyaltyRewardsPanel } from "../components/loyalty/LoyaltyRewardsPanel";
import { LoyaltyCustomerOffersPanel } from "../components/loyalty/LoyaltyCustomerOffersPanel";
import { LoyaltyCustomerRewardsPanel } from "../components/loyalty/LoyaltyCustomerRewardsPanel";
import { LoyaltyGoogleWalletButton } from "../components/loyalty/LoyaltyGoogleWalletButton";
import { LoyaltyCustomerPageShare } from "../components/loyalty/LoyaltyCustomerPageShare";
import { LoyaltyCardDesignPanel } from "../components/loyalty/LoyaltyCardDesignPanel";
import { LoyaltySpendPromotionsPanel } from "../components/loyalty/LoyaltySpendPromotionsPanel";
import {
  LoyaltyCustomer360Panel,
  LoyaltyCustomerLookup,
} from "../components/loyalty/LoyaltyCustomer360Panel";
import { LoyaltyProgramCodePanel } from "../components/loyalty/LoyaltyProgramCodePanel";
import { LoyaltyPublicEnrollmentPanel } from "../components/loyalty/LoyaltyPublicEnrollmentPanel";
import { LoyaltyEnrollmentRequestsPanel } from "../components/loyalty/LoyaltyEnrollmentRequestsPanel";
import {
  fetchLoyaltyRewards,
  isRewardEligible,
  isRewardUnexpiredClient,
  newRedemptionIdempotencyKey,
  redeemLoyaltyReward,
  type LoyaltyReward,
} from "../lib/loyalty/loyaltyRewards";
import { requestGoogleWalletBalanceSync } from "../lib/loyalty/loyaltyGoogleWallet";
import { fetchLoyaltyUsage, type LoyaltyUsage } from "../lib/loyalty/loyaltyUsage";
import { loyaltyErrorKey } from "../lib/loyalty/loyaltyErrorMessages";
import type { LoyaltyMemberStatusFilter } from "../lib/loyalty/loyaltyMerchant";
import { usePosStore } from "../store/usePosStore";

const MEMBER_STATUS_FILTERS: LoyaltyMemberStatusFilter[] = [
  "all",
  "active",
  "suspended",
  "revoked",
  "expired",
];

type HubTab = LoyaltySectionId;

const KIND_LABEL_KEY: Record<string, string> = {
  earned: "loyaltyKindEarned",
  redeemed: "loyaltyKindRedeemed",
  reversed: "loyaltyKindReversed",
  expired: "loyaltyKindExpired",
  adjusted: "loyaltyKindAdjusted",
  promotional: "loyaltyKindPromotional",
};

function kindLabel(lang: Language, kind: string): string {
  return t(lang, KIND_LABEL_KEY[kind] ?? "loyaltyKindAdjusted");
}

function formatDate(lang: Language, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === "lg" ? "lg-UG" : lang === "sw" ? "sw-UG" : "en-UG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(lang: Language, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "lg" ? "lg-UG" : lang === "sw" ? "sw-UG" : "en-UG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "default" | "accent" }) {
  return (
    <div
      className={clsx(
        "rounded-2xl border p-4 shadow-sm",
        tone === "accent" ? "border-waka-300 bg-waka-50" : "border-border bg-card",
      )}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-black text-foreground">{value}</p>
    </div>
  );
}

function HistoryList({ lang, rows }: { lang: Language; rows: LoyaltyTransactionRow[] }) {
  if (rows.length === 0) {
    return <p className="py-3 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyNoHistory")}</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">
              {kindLabel(lang, row.kind)}
              {row.note ? <span className="font-medium text-muted-foreground"> — {row.note}</span> : null}
            </p>
            <p className="text-xs font-medium text-muted-foreground">{formatDateTime(lang, row.createdAt)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p
              className={clsx(
                "text-sm font-black",
                row.points > 0 ? "text-success" : "text-destructive",
              )}
            >
              {row.points > 0 ? "+" : ""}
              {row.points} {t(lang, "loyaltyPointsUnit")}
            </p>
            {row.balanceAfter != null ? (
              <p className="text-xs font-medium text-muted-foreground">
                {t(lang, "loyaltyPointsBalanceLabel")}: {row.balanceAfter}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function MemberQrBlock({
  lang,
  shopId,
  accountId,
}: {
  lang: Language;
  shopId: string;
  accountId: string;
}) {
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    void fetchLoyaltyAccountQrToken(shopId, accountId).then((token) => {
      if (cancelled) return;
      if (token) {
        setQrToken(token);
        setLoadState("ready");
      } else {
        setQrToken(null);
        setLoadState("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shopId, accountId]);

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <h3 className="text-sm font-black text-foreground">{t(lang, "loyaltyMemberQrTitle")}</h3>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "loyaltyMemberQrHint")}</p>
      <div className="mt-3 flex justify-center">
        {loadState === "loading" ? (
          <div className="w-[180px]">
            <EnterpriseSkeleton variant="card" />
          </div>
        ) : null}
        {loadState === "error" ? (
          <p className="py-4 text-center text-sm font-medium text-destructive">{t(lang, "loyaltyMemberQrUnavailable")}</p>
        ) : null}
        {loadState === "ready" && qrToken ? <LoyaltyMemberQr qrToken={qrToken} size={180} /> : null}
      </div>
    </div>
  );
}

function CustomerDetail({
  lang,
  shopId,
  entry,
  canManage,
  canRedeem,
  canIssueWallet,
  mode,
  onAdjusted,
}: {
  lang: Language;
  shopId: string;
  entry: LoyaltyAccountListEntry;
  canManage: boolean;
  canRedeem: boolean;
  canIssueWallet: boolean;
  /** Full member tools vs card-focused view (QR + Wallet). */
  mode: "full" | "card";
  onAdjusted: () => void;
}) {
  const [history, setHistory] = useState<LoyaltyTransactionRow[] | null>(null);
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustState, setAdjustState] = useState<"idle" | "saving" | "done" | "error">("idle");
  /** Client-side validation messages — an i18n KEY, translated at render time. */
  const [adjustValidation, setAdjustValidation] = useState<string | null>(null);
  /** Raw RPC error code from the last failed adjustment — mapped through loyaltyErrorKey. */
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [renewState, setRenewState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [renewError, setRenewError] = useState<string | null>(null);
  const [expiryMode, setExpiryMode] = useState<"never" | "fixed_date">(
    entry.membershipExpiresOn ? "fixed_date" : "never",
  );
  const [expiryDate, setExpiryDate] = useState(entry.membershipExpiresOn ?? "");
  const [showExpiryEditor, setShowExpiryEditor] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"suspend" | "revoke" | null>(null);
  // null = still fetching — distinguishes "loading" from a genuinely empty catalog.
  const [rewards, setRewards] = useState<LoyaltyReward[] | null>(null);
  const [pendingRedeem, setPendingRedeem] = useState<{ rewardId: string; key: string } | null>(null);
  const [redeemState, setRedeemState] = useState<
    | { phase: "idle" }
    | { phase: "busy" }
    | { phase: "done"; balance: number }
    | { phase: "duplicate" }
    | { phase: "error"; error: string; balance?: number; required?: number }
  >({ phase: "idle" });

  useEffect(() => {
    if (mode !== "full") return;
    let cancelled = false;
    void (async () => {
      const rows = await fetchAccountHistory(shopId, entry.accountId);
      if (!cancelled) setHistory(rows);
    })();
    void (async () => {
      const rows = await fetchLoyaltyRewards(shopId);
      if (!cancelled) setRewards(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId, entry.accountId, mode]);

  useEffect(() => {
    setRenewState("idle");
    setShowExpiryEditor(false);
    setConfirmAction(null);
    setLifecycleError(null);
    setExpiryMode(entry.membershipExpiresOn ? "fixed_date" : "never");
    setExpiryDate(entry.membershipExpiresOn ?? "");
  }, [entry.accountId, entry.membershipActive, entry.membershipExpiresOn, entry.status]);

  const submitRenew = async () => {
    setRenewState("saving");
    setRenewError(null);
    const result = await renewLoyaltyMembership(shopId, entry.accountId, {});
    if (result.ok) {
      setRenewState("done");
      onAdjusted();
    } else {
      // Renewing an expired member restores an active member, so the server may refuse
      // it at the allowance. Keep the code and translate it at render time.
      setRenewError(result.error);
      setRenewState("error");
    }
  };

  const submitExpiryChange = async () => {
    setRenewState("saving");
    setLifecycleError(null);
    const result =
      expiryMode === "never"
        ? await renewLoyaltyMembership(shopId, entry.accountId, { mode: "never" })
        : await renewLoyaltyMembership(shopId, entry.accountId, {
            mode: "fixed_date",
            fixedExpiresOn: expiryDate.trim() || null,
          });
    if (result.ok) {
      setRenewState("done");
      setShowExpiryEditor(false);
      onAdjusted();
    } else {
      setRenewState("error");
      setLifecycleError(result.error);
    }
  };

  const runLifecycle = async (action: "suspend" | "reactivate" | "revoke") => {
    setLifecycleBusy(true);
    setLifecycleError(null);
    const result = await setLoyaltyAccountLifecycle(shopId, entry.accountId, action);
    setLifecycleBusy(false);
    setConfirmAction(null);
    if (result.ok) onAdjusted();
    else setLifecycleError(result.error);
  };

  const statusLabel =
    entry.status === "revoked"
      ? t(lang, "loyaltyLifecycleRevoked")
      : entry.status === "suspended"
        ? t(lang, "loyaltyLifecycleSuspended")
        : t(lang, "loyaltyLifecycleActive");

  const beginRedeem = (rewardId: string) => {
    setRedeemState({ phase: "idle" });
    setPendingRedeem({ rewardId, key: newRedemptionIdempotencyKey() });
  };

  /**
   * Dismissing the confirmation dialog NEVER calls the RPC. The idempotency intent
   * (pendingRedeem) survives a failure so a retry reuses the same key; the failure
   * message stays visible on the card via its role="status" region.
   */
  const cancelRedeem = () => {
    if (redeemState.phase === "busy") return;
    setPendingRedeem(null);
  };

  /** The reward this confirmation intent is for — display data for the dialog only. */
  const pendingReward = pendingRedeem
    ? (rewards ?? []).find((r) => r.id === pendingRedeem.rewardId) ?? null
    : null;

  const confirmRedeem = async () => {
    if (!pendingRedeem) return;
    setRedeemState({ phase: "busy" });
    const result = await redeemLoyaltyReward(shopId, entry.accountId, pendingRedeem.rewardId, pendingRedeem.key);
    if (result.ok) {
      setRedeemState(result.alreadyRedeemed ? { phase: "duplicate" } : { phase: "done", balance: result.balance });
      setPendingRedeem(null);
      onAdjusted();
      void requestGoogleWalletBalanceSync(shopId, entry.accountId);
    } else {
      setRedeemState({ phase: "error", error: result.error, balance: result.balance, required: result.required });
    }
  };

  const submitAdjust = async () => {
    const points = Number(adjustPoints);
    // Validation failures are reported inline instead of silently returning.
    if (!Number.isInteger(points) || points === 0) {
      setAdjustValidation("loyaltyAdjustInvalidPoints");
      return;
    }
    if (!adjustNote.trim()) {
      setAdjustValidation("loyaltyAdjustNoteRequired");
      return;
    }
    setAdjustValidation(null);
    setAdjustError(null);
    setAdjustState("saving");
    const result = await adjustLoyaltyPoints(entry.accountId, points, adjustNote);
    if (result.ok) {
      setAdjustState("done");
      setAdjustPoints("");
      setAdjustNote("");
      onAdjusted();
      void requestGoogleWalletBalanceSync(shopId, entry.accountId);
    } else {
      setAdjustState("error");
      setAdjustError(result.error);
    }
  };

  return (
    <div className="mt-3 space-y-4 rounded-2xl border border-border bg-muted/50 p-4">
      <div>
        <h3 className="text-sm font-black text-foreground">{t(lang, "loyaltyCustomerCardSectionTitle")}</h3>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "loyaltyCustomerCardSectionSub")}</p>
        {mode === "full" ? (
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyEnrolledOn")}</p>
              <p className="font-bold text-foreground">{formatDate(lang, entry.enrolledAt)}</p>
            </div>
            <div>
              <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyPointsBalanceLabel")}</p>
              <p className="font-bold text-foreground">
                {entry.balancePoints} {t(lang, "loyaltyPointsUnit")}
              </p>
            </div>
            <div>
              <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyLifetimeEarned")}</p>
              <p className="font-bold text-foreground">
                {entry.lifetimeEarnedPoints} {t(lang, "loyaltyPointsUnit")}
              </p>
            </div>
            <div>
              <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyLifetimeRedeemed")}</p>
              <p className="font-bold text-foreground">
                {entry.lifetimeRedeemedPoints} {t(lang, "loyaltyPointsUnit")}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-xl bg-card px-3 py-2">
            <p className="text-base font-black text-foreground">{entry.customerName}</p>
            <p className="text-sm font-bold text-muted-foreground">
              {entry.balancePoints} {t(lang, "loyaltyPointsUnit")} · {t(lang, "loyaltyPointsBalanceLabel")}
            </p>
          </div>
        )}
      </div>

      {mode === "full" ? (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-3">
          <div>
            <h3 className="text-sm font-black text-foreground">{t(lang, "loyaltyLifecycleTitle")}</h3>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "loyaltyLifecycleHint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyLifecycleStatus")}</p>
              <p className="font-bold text-foreground">{statusLabel}</p>
            </div>
            <div>
              <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyMembershipDate")}</p>
              <p className="font-bold text-foreground">
                {entry.membershipExpiresOn
                  ? formatDate(lang, entry.membershipExpiresOn)
                  : t(lang, "loyaltyMembershipNever")}
              </p>
            </div>
            {entry.status === "revoked" ? (
              <>
                <div>
                  <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyLifecycleRevokedOn")}</p>
                  <p className="font-bold text-foreground">
                    {entry.revokedAt ? formatDate(lang, entry.revokedAt) : "—"}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-muted-foreground">{t(lang, "loyaltyLifecyclePurgesAfter")}</p>
                  <p className="font-bold text-foreground">
                    {entry.purgeAfter ? formatDate(lang, entry.purgeAfter) : "—"}
                  </p>
                </div>
              </>
            ) : null}
          </div>

          {entry.status !== "revoked" && entry.status === "active" && !entry.membershipActive ? (
            <p className="text-sm font-bold text-destructive">{t(lang, "loyaltyMembershipExpired")}</p>
          ) : null}

          {canManage && entry.status !== "revoked" ? (
            <div className="flex flex-wrap gap-2">
              <WakaButton type="button" variant="secondary" onClick={() => setShowExpiryEditor((v) => !v)}>
                {t(lang, "loyaltyLifecycleChangeExpiry")}
              </WakaButton>
              {entry.status === "active" ? (
                <WakaButton
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmAction("suspend")}
                  disabled={lifecycleBusy}
                >
                  {t(lang, "loyaltyLifecycleSuspend")}
                </WakaButton>
              ) : null}
              {entry.status === "suspended" ? (
                <WakaButton
                  type="button"
                  onClick={() => void runLifecycle("reactivate")}
                  disabled={lifecycleBusy}
                >
                  {t(lang, "loyaltyLifecycleReactivate")}
                </WakaButton>
              ) : null}
              {entry.status === "active" || entry.status === "suspended" ? (
                <WakaButton
                  type="button"
                  variant="danger"
                  onClick={() => setConfirmAction("revoke")}
                  disabled={lifecycleBusy}
                >
                  {t(lang, "loyaltyLifecycleRevoke")}
                </WakaButton>
              ) : null}
              {entry.status === "active" && !entry.membershipActive ? (
                <WakaButton
                  type="button"
                  onClick={() => void submitRenew()}
                  disabled={renewState === "saving"}
                >
                  {t(lang, "loyaltyMembershipRenew")}
                </WakaButton>
              ) : null}
            </div>
          ) : null}

          {showExpiryEditor && canManage && entry.status !== "revoked" ? (
            <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <input
                  type="radio"
                  checked={expiryMode === "never"}
                  onChange={() => setExpiryMode("never")}
                />
                {t(lang, "loyaltyMembershipNever")}
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <input
                  type="radio"
                  checked={expiryMode === "fixed_date"}
                  onChange={() => setExpiryMode("fixed_date")}
                />
                {t(lang, "loyaltyMembershipFixed")}
              </label>
              {expiryMode === "fixed_date" ? (
                <input
                  type="date"
                  aria-label={t(lang, "loyaltyMembershipFixed")}
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border-2 border-border bg-card px-2 text-sm font-semibold"
                />
              ) : null}
              <WakaButton
                type="button"
                onClick={() => void submitExpiryChange()}
                disabled={renewState === "saving" || (expiryMode === "fixed_date" && !expiryDate)}
              >
                {t(lang, "loyaltyLifecycleSaveExpiry")}
              </WakaButton>
            </div>
          ) : null}

          {confirmAction === "suspend" ? (
            <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
              <p className="text-sm font-semibold text-foreground">{t(lang, "loyaltyLifecycleSuspendConfirm")}</p>
              <div className="flex gap-2">
                <WakaButton type="button" onClick={() => void runLifecycle("suspend")} disabled={lifecycleBusy}>
                  {t(lang, "loyaltyLifecycleConfirm")}
                </WakaButton>
                <WakaButton type="button" variant="secondary" onClick={() => setConfirmAction(null)}>
                  {t(lang, "cancel")}
                </WakaButton>
              </div>
            </div>
          ) : null}

          {confirmAction === "revoke" ? (
            <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-semibold text-foreground">{t(lang, "loyaltyLifecycleRevokeConfirm")}</p>
              <div className="flex gap-2">
                <WakaButton type="button" variant="danger" onClick={() => void runLifecycle("revoke")} disabled={lifecycleBusy}>
                  {t(lang, "loyaltyLifecycleConfirmRevoke")}
                </WakaButton>
                <WakaButton type="button" variant="secondary" onClick={() => setConfirmAction(null)}>
                  {t(lang, "cancel")}
                </WakaButton>
              </div>
            </div>
          ) : null}

          {/* Persistent live region: renew + lifecycle outcomes (P4). */}
          <div role="status">
            {renewState === "done" ? (
              <span className="text-sm font-bold text-success">{t(lang, "loyaltyMembershipRenewed")}</span>
            ) : null}
            {/* Translated, never the raw RPC code — and specific enough to act on. */}
            {lifecycleError ? (
              <span className="text-sm font-bold text-destructive">
                {t(lang, loyaltyErrorKey(lifecycleError))}
              </span>
            ) : null}
            {renewState === "error" ? (
              <span className="text-sm font-bold text-destructive">
                {t(lang, loyaltyErrorKey(renewError))}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <MemberQrBlock lang={lang} shopId={shopId} accountId={entry.accountId} />

      <LoyaltyCustomerPageShare lang={lang} shopId={shopId} accountId={entry.accountId} />

      <LoyaltyGoogleWalletButton
        lang={lang}
        shopId={shopId}
        accountId={entry.accountId}
        canIssue={canIssueWallet}
        memberStatus={entry.status}
      />

      {mode === "full" ? (
        <LoyaltyCustomerRewardsPanel
          lang={lang}
          shopId={shopId}
          accountId={entry.accountId}
          canManage={canManage}
        />
      ) : null}

      {mode === "full" ? (
        <LoyaltyCustomerOffersPanel
          lang={lang}
          shopId={shopId}
          accountId={entry.accountId}
          canManage={canManage}
        />
      ) : null}

      {mode === "full" ? (
        <>
          <div>
            <h3 className="text-sm font-black text-foreground">{t(lang, "loyaltyHistoryTitle")}</h3>
            {history === null ? (
              <div className="py-1">
                <EnterpriseSkeletonList count={3} />
              </div>
            ) : (
              <HistoryList lang={lang} rows={history} />
            )}
          </div>

          {canRedeem ? (
            <div className="rounded-2xl border border-border bg-card p-3">
              <h3 className="text-sm font-black text-foreground">{t(lang, "loyaltyRedeemTitle")}</h3>
              {rewards === null ? (
                <div className="mt-2">
                  <EnterpriseSkeletonList count={2} />
                </div>
              ) : rewards.length === 0 ? (
                <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "loyaltyNoRewards")}</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {rewards
                    .filter((reward) => reward.active && isRewardUnexpiredClient(reward.expiresOn))
                    .map((reward) => {
                      const eligible = isRewardEligible(reward, entry.balancePoints);
                      return (
                        <li key={reward.id} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-foreground">{reward.name}</p>
                            <p className="text-xs font-medium text-muted-foreground">
                              {tTemplate(lang, "loyaltyRewardCost", { points: reward.pointsRequired })}
                              {reward.description ? ` · ${reward.description}` : ""}
                            </p>
                            {/* P6 — a disabled Redeem button must say why. */}
                            {!eligible ? (
                              <p className="mt-0.5 text-xs font-bold text-warning-foreground">
                                {tTemplate(lang, "loyaltyRewardNeedsPoints", {
                                  needed: pointsStillNeeded(reward.pointsRequired, entry.balancePoints),
                                  balance: entry.balancePoints,
                                })}
                              </p>
                            ) : null}
                          </div>
                          <WakaButton
                            type="button"
                            variant="secondary"
                            onClick={() => beginRedeem(reward.id)}
                            disabled={!eligible}
                            className="shrink-0"
                          >
                            {t(lang, "loyaltyRedeemAction")}
                          </WakaButton>
                        </li>
                      );
                    })}
                </ul>
              )}
              {/* Persistent live region: polite announcements for redeem outcomes. */}
              <div role="status">
              {redeemState.phase === "done" ? (
                <p className="mt-2 text-sm font-bold text-success">
                  {tTemplate(lang, "loyaltyRedeemDone", { balance: redeemState.balance })}
                </p>
              ) : null}
              {redeemState.phase === "duplicate" ? (
                <p className="mt-2 text-sm font-bold text-muted-foreground">{t(lang, "loyaltyRedeemAlready")}</p>
              ) : null}
              {redeemState.phase === "error" ? (
                <p className="mt-2 text-sm font-bold text-destructive">
                  {redeemErrorMessage(
                    lang,
                    redeemState.error,
                    redeemState.balance ?? entry.balancePoints,
                    redeemState.required,
                  )}
                </p>
              ) : null}
              </div>
            </div>
          ) : null}

          {canManage ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-3">
              <button
                type="button"
                onClick={() => setShowAdjust((v) => !v)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="text-sm font-black text-foreground">{t(lang, "loyaltyAdjustAdvanced")}</span>
                <span className="text-xs font-bold text-muted-foreground">
                  {showAdjust ? t(lang, "loyaltyHideAdvanced") : t(lang, "loyaltyShowAdvanced")}
                </span>
              </button>
              {showAdjust ? (
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted-foreground">{t(lang, "loyaltyAdjustDangerHint")}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      aria-label={t(lang, "loyaltyAdjustPointsLabel")}
                      value={adjustPoints}
                      onChange={(e) => {
                        setAdjustPoints(e.target.value);
                        setAdjustValidation(null);
                      }}
                      placeholder="+10 / -50"
                      className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                    />
                    <input
                      aria-label={t(lang, "loyaltyAdjustNotePlaceholder")}
                      value={adjustNote}
                      onChange={(e) => {
                        setAdjustNote(e.target.value);
                        setAdjustValidation(null);
                      }}
                      placeholder={t(lang, "loyaltyAdjustNotePlaceholder")}
                      className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <WakaButton
                      type="button"
                      onClick={() => void submitAdjust()}
                      disabled={adjustState === "saving"}
                    >
                      {t(lang, "loyaltyAdjustApply")}
                    </WakaButton>
                    <div role="status">
                      {adjustValidation ? (
                        <span className="text-sm font-bold text-warning-foreground">
                          {t(lang, adjustValidation)}
                        </span>
                      ) : null}
                      {adjustState === "done" ? (
                        <span className="text-sm font-bold text-success">{t(lang, "loyaltySaved")}</span>
                      ) : null}
                      {adjustState === "error" ? (
                        <span className="text-sm font-bold text-destructive">
                          {t(lang, loyaltyErrorKey(adjustError))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {/* P3 — confirmation dialog. Open ⇔ a redemption intent exists; confirming runs
          the untouched confirmRedeem() (same idempotency key), cancel/close never
          reaches the RPC. */}
      <ConfirmationDialog
        lang={lang}
        open={pendingRedeem != null}
        onClose={cancelRedeem}
        title={t(lang, "loyaltyRedeemConfirmTitle")}
        onConfirm={() => void confirmRedeem()}
        confirmDisabled={redeemState.phase === "busy"}
        confirmBusy={redeemState.phase === "busy"}
      >
        {pendingReward ? (
          <div className="space-y-1.5">
            <p className="font-black text-foreground">{pendingReward.name}</p>
            <p>{tTemplate(lang, "loyaltyRedeemConfirm", { points: pendingReward.pointsRequired })}</p>
            <p>{tTemplate(lang, "loyaltyRedeemConfirmBalance", { balance: entry.balancePoints })}</p>
            <p>
              {tTemplate(lang, "loyaltyRedeemConfirmBalanceAfter", {
                balance: balanceAfterRedeem(entry.balancePoints, pendingReward.pointsRequired),
              })}
            </p>
            {redeemState.phase === "error" ? (
              <p className="font-bold text-destructive">
                {redeemErrorMessage(lang, redeemState.error, redeemState.balance, redeemState.required)}
              </p>
            ) : null}
          </div>
        ) : null}
      </ConfirmationDialog>
    </div>
  );
}

function CustomerList({
  lang,
  shopId,
  accounts,
  search,
  searchDone,
  expandedId,
  canManage,
  canRedeem,
  canIssueWallet,
  mode,
  statusFilter,
  onStatusFilterChange,
  onSearchChange,
  onToggle,
  onAdjusted,
}: {
  lang: Language;
  shopId: string;
  accounts: LoyaltyAccountListEntry[];
  search: string;
  searchDone: boolean;
  expandedId: string | null;
  canManage: boolean;
  canRedeem: boolean;
  canIssueWallet: boolean;
  mode: "full" | "card";
  statusFilter: LoyaltyMemberStatusFilter;
  onStatusFilterChange: (value: LoyaltyMemberStatusFilter) => void;
  onSearchChange: (value: string) => void;
  onToggle: (accountId: string) => void;
  onAdjusted: () => void;
}) {
  // P4 — the list-row renew used to fail silently; track busy + outcome per row.
  const [renewBusyId, setRenewBusyId] = useState<string | null>(null);
  const [renewFeedback, setRenewFeedback] = useState<
    { accountId: string; ok: boolean; error?: string } | null
  >(null);

  const runListRenew = async (accountId: string) => {
    setRenewBusyId(accountId);
    setRenewFeedback(null);
    const result = await renewLoyaltyMembership(shopId, accountId, {});
    setRenewBusyId(null);
    if (result.ok) {
      setRenewFeedback({ accountId, ok: true });
      onAdjusted();
    } else {
      setRenewFeedback({ accountId, ok: false, error: result.error });
    }
  };

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-black text-foreground">
          {mode === "card" ? t(lang, "loyaltyCardsPickCustomer") : t(lang, "loyaltyCustomersTitle")}
        </h2>
        {/* P12 — jump from the list to the enrollment panel below it. */}
        {mode === "full" ? (
          <WakaButton
            type="button"
            variant="secondary"
            onClick={() => {
              const el = document.getElementById("loyalty-enroll");
              el?.scrollIntoView({ behavior: "smooth", block: "start" });
              el?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
            }}
          >
            {t(lang, "loyaltyEnrollCta")}
          </WakaButton>
        ) : null}
      </div>
      <WakaInput
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label={t(lang, "loyaltyMembersSearchLabel")}
        placeholder={t(lang, "loyaltySearchPlaceholder")}
        className="mt-3"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {MEMBER_STATUS_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={statusFilter === f}
            onClick={() => onStatusFilterChange(f)}
            className={clsx(
              "min-h-[44px] rounded-xl px-3 text-xs font-black",
              statusFilter === f ? "bg-waka-600 text-white" : "bg-muted text-foreground",
            )}
          >
            {t(lang, `loyaltyMemberFilter_${f}`)}
          </button>
        ))}
      </div>
      {!searchDone && accounts.length === 0 ? (
        /* First search still in flight — defined loading instead of an empty list. */
        <div className="mt-3">
          <EnterpriseSkeletonList count={3} />
        </div>
      ) : searchDone && accounts.length === 0 ? (
        <>
          <div className="mt-3">
            <EnterpriseEmptyState
              icon={UserSearch}
              title={
                search.trim() ? t(lang, "loyaltyNoMembersFound") : t(lang, "loyaltyNoMembers")
              }
            />
          </div>
          {/* Phase C — the member search only finds loyalty customers. A customer with
              purchases and no loyalty card is still somebody the merchant must be able to
              look up, so the same Customer 360 is reachable from here. Additive: it only
              appears where the member search found nothing. */}
          {search.trim() ? (
            <div className="mt-4 border-t border-border pt-4">
              <LoyaltyCustomerLookup lang={lang} shopId={shopId} />
            </div>
          ) : null}
        </>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {accounts.map((entry) => (
            <li key={entry.accountId} className="py-2">
              <button
                type="button"
                onClick={() => onToggle(entry.accountId)}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-muted"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-foreground">{entry.customerName}</p>
                  <p className="text-xs font-medium text-muted-foreground">
                    {entry.customerPhone ?? ""}
                    {entry.customerPhone ? " · " : ""}
                    {entry.status === "revoked"
                      ? t(lang, "loyaltyLifecycleRevoked")
                      : entry.status === "suspended"
                        ? t(lang, "loyaltyLifecycleSuspended")
                        : t(lang, "loyaltyCustomerStatusActive")}
                    {entry.status === "active" && !entry.membershipActive
                      ? ` · ${t(lang, "loyaltyMembershipExpired")}`
                      : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-black text-foreground">
                    {entry.balancePoints} {t(lang, "loyaltyPointsUnit")}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t(lang, "loyaltyPointsBalanceLabel")}
                  </p>
                </div>
              </button>
              {!entry.membershipActive && canManage && entry.status === "active" ? (
                <div className="mt-1 px-2 pb-1">
                  <WakaButton
                    type="button"
                    variant="secondary"
                    onClick={() => void runListRenew(entry.accountId)}
                    disabled={renewBusyId === entry.accountId}
                  >
                    {renewBusyId === entry.accountId
                      ? t(lang, "loyaltyLoading")
                      : t(lang, "loyaltyMembershipRenew")}
                  </WakaButton>
                  {/* Persistent live region: success or the mapped failure (P4). */}
                  <div role="status">
                    {renewFeedback?.accountId === entry.accountId ? (
                      renewFeedback.ok ? (
                        <p className="mt-1 text-xs font-bold text-success">
                          {t(lang, "loyaltyMembershipRenewed")}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs font-bold text-destructive">
                          {t(lang, loyaltyErrorKey(renewFeedback.error))}
                        </p>
                      )
                    ) : null}
                  </div>
                </div>
              ) : null}
              {expandedId === entry.accountId ? (
                <>
                  <CustomerDetail
                    lang={lang}
                    shopId={shopId}
                    entry={entry}
                    canManage={canManage}
                    canRedeem={canRedeem}
                    canIssueWallet={canIssueWallet}
                    mode={mode}
                    onAdjusted={onAdjusted}
                  />
                  {/* Phase C — the customer's relationship with THIS shop: what they have
                      spent, what came back, and what they have redeemed. Read-only, and
                      scoped to this shop by the server. */}
                  <LoyaltyCustomer360Panel
                    lang={lang}
                    shopId={shopId}
                    customerId={entry.customerId}
                    canReverse={canRedeem}
                  />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function LoyaltyHubPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const canManage = actorHasPermission(actor, "settings.shop");
  const canRedeem = actorHasPermission(actor, "loyalty.redeem");
  const canIssueWallet = actorHasPermission(actor, "loyalty.wallet_issue");
  const shopDisplayName = usePosStore((s) => s.preferences.shopDisplayName?.trim() || "Shop");
  const [shopId, setShopId] = useState<string | null>(null);
  const [overview, setOverview] = useState<LoyaltyOverview | null>(null);
  const [usage, setUsage] = useState<LoyaltyUsage | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState<ProgramInput>({ ...DEFAULT_LOYALTY_PROGRAM });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<LoyaltyMemberStatusFilter>("all");
  const [accounts, setAccounts] = useState<LoyaltyAccountListEntry[]>([]);
  const [searchDone, setSearchDone] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showEarnAdvanced, setShowEarnAdvanced] = useState(false);
  const navigate = useNavigate();
  const routeParams = useParams<{ section?: string }>();
  const tab: HubTab = resolveLoyaltySection(routeParams.section);
  const searchSeq = useRef(0);

  const loadOverview = useCallback(async (id: string) => {
    const next = await fetchLoyaltyOverview(id);
    if (next) {
      setOverview(next);
      setLoadState("ready");
      if (next.program) {
        setDraft({
          enabled: next.program.enabled,
          earnUnitUgx: next.program.earnUnitUgx,
          earnPointsPerUnit: next.program.earnPointsPerUnit,
          minEligibleSpendUgx: next.program.minEligibleSpendUgx,
          membershipExpiryMode: next.program.membershipExpiryMode,
          membershipFixedExpiresOn: next.program.membershipFixedExpiresOn,
          membershipDurationMonths: next.program.membershipDurationMonths,
          pointsExpiryMode: next.program.pointsExpiryMode,
          pointsExpiryMonths: next.program.pointsExpiryMonths,
        });
        // Open Advanced when the shop already uses a non-simple rule.
        if (next.program.earnPointsPerUnit !== 1 || next.program.minEligibleSpendUgx > 0) {
          setShowEarnAdvanced(true);
        }
      }
    } else {
      setLoadState("error");
    }
  }, []);

  /** Entitlement + usage come from the server's single authoritative call. */
  const loadUsage = useCallback(async (id: string) => {
    setUsage(await fetchLoyaltyUsage(id));
  }, []);

  /**
   * One load path for mount AND Retry: resolve the shop, then run the same overview +
   * usage operations. Recovery therefore never needs a full page refresh. The previous
   * per-effect `cancelled` flag only guarded setState-after-unmount, which React 18
   * ignores; the operations themselves are unchanged. Mount starts in the "loading"
   * initial state, and Retry flips back to "loading" in its event handler, so this
   * callback itself never sets state synchronously inside an effect.
   */
  const loadHub = useCallback(async () => {
    const ctx = await resolveShopCtx();
    const id = ctx?.shopId ?? null;
    setShopId(id);
    if (id) {
      await loadOverview(id);
      await loadUsage(id);
    } else setLoadState("error");
  }, [loadOverview, loadUsage]);

  useEffect(() => {
    void (async () => {
      await loadHub();
    })();
  }, [loadHub]);

  const runSearch = useCallback(
    async (id: string, query: string, status: LoyaltyMemberStatusFilter) => {
      const seq = ++searchSeq.current;
      // The status filter is applied by the SERVER before its LIMIT; filtering here
      // would silently misrepresent a capped page.
      const rows = await searchLoyaltyAccounts(id, query, status);
      if (seq !== searchSeq.current) return;
      setAccounts(rows);
      setSearchDone(true);
    },
    [],
  );

  // Canonical path for the active section (also maps legacy tab ids like `customers`).
  useEffect(() => {
    const canonical = loyaltySectionPath(tab);
    const current = routeParams.section;
    if (current !== tab) {
      navigate(canonical, { replace: true });
    }
  }, [tab, routeParams.section, navigate]);

  useEffect(() => {
    if (!shopId || loadState !== "ready") return;
    if (tab !== "members") return;
    const handle = window.setTimeout(() => void runSearch(shopId, search, statusFilter), 250);
    return () => window.clearTimeout(handle);
  }, [shopId, search, statusFilter, loadState, runSearch, tab]);

  const programEnabled = overview?.program?.enabled ?? false;
  const programConfigured = overview?.program != null;
  const inputError = useMemo(() => validateProgramInput(draft), [draft]);

  const earnExamples = useMemo(() => {
    const spends = [1000, 10_000, 50_000];
    return spends.map((spend) => ({
      spend,
      points: computeEarnedPoints(spend, {
        enabled: true,
        earnUnitUgx: draft.earnUnitUgx,
        earnPointsPerUnit: draft.earnPointsPerUnit,
        minEligibleSpendUgx: draft.minEligibleSpendUgx,
        membershipExpiryMode: draft.membershipExpiryMode,
        membershipFixedExpiresOn: draft.membershipFixedExpiresOn,
        membershipDurationMonths: draft.membershipDurationMonths,
        pointsExpiryMode: draft.pointsExpiryMode,
        pointsExpiryMonths: draft.pointsExpiryMonths,
      }),
    }));
  }, [
    draft.earnUnitUgx,
    draft.earnPointsPerUnit,
    draft.minEligibleSpendUgx,
    draft.membershipExpiryMode,
    draft.membershipFixedExpiresOn,
    draft.membershipDurationMonths,
    draft.pointsExpiryMode,
    draft.pointsExpiryMonths,
  ]);

  const submitSave = async () => {
    if (!shopId || inputError) return;
    setSaveState("saving");
    const result = await saveLoyaltyProgram(shopId, draft);
    if (result.ok) {
      setSaveState("done");
      await loadOverview(shopId);
      void runSearch(shopId, search, statusFilter);
    } else {
      setSaveState("error");
    }
  };

  const refreshLists = () => {
    if (!shopId) return;
    void loadOverview(shopId);
    void loadUsage(shopId);
    void runSearch(shopId, search, statusFilter);
  };

  return (
    <LoyaltyShell
      lang={lang}
      canManage={canManage}
      onSectionChange={() => {
        setExpandedId(null);
      }}
    >
      {loadState === "loading" ? (
        <div className="space-y-4" aria-busy="true">
          <EnterpriseSkeleton variant="kpi" />
          <EnterpriseSkeleton variant="card" />
          <EnterpriseSkeleton variant="card" />
        </div>
      ) : null}

      {loadState === "error" ? (
        <EnterpriseErrorState
          title={t(lang, "loyaltyUnavailable")}
          retryLabel={t(lang, "loyaltyRetry")}
          onRetry={() => {
            setLoadState("loading");
            void loadHub();
          }}
        />
      ) : null}

      {loadState === "ready" && overview ? (
        <div className="space-y-4">
          {tab === "overview" ? (
            <div className="space-y-4">
              <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-black text-foreground">{t(lang, "loyaltyProgramStatusTitle")}</h2>
                  <span
                    className={clsx(
                      "rounded-full px-3 py-1 text-xs font-black",
                      programConfigured && programEnabled
                        ? "bg-success-muted text-success"
                        : programConfigured
                          ? "bg-muted text-muted-foreground"
                          : "bg-warning-muted text-warning-foreground",
                    )}
                  >
                    {programConfigured
                      ? programEnabled
                        ? t(lang, "loyaltyProgramActive")
                        : t(lang, "loyaltyProgramInactive")
                      : t(lang, "loyaltyProgramNotSetup")}
                  </span>
                </div>

                {canManage ? (
                  <div className="mt-4">
                    <WakaSwitch
                      checked={draft.enabled}
                      onCheckedChange={(checked) => {
                        setDraft((d) => ({ ...d, enabled: checked }));
                        setSaveState("idle");
                      }}
                      label={t(lang, "loyaltyEnabledLabel")}
                    />
                    <div className="mt-3 flex items-center gap-3">
                      <WakaButton
                        type="button"
                        onClick={() => void submitSave()}
                        disabled={saveState === "saving" || inputError != null}
                      >
                        {t(lang, "loyaltySave")}
                      </WakaButton>
                      <div role="status">
                        {saveState === "done" ? (
                          <span className="text-sm font-bold text-success">{t(lang, "loyaltySaved")}</span>
                        ) : null}
                        {saveState === "error" ? (
                          <span className="text-sm font-bold text-destructive">{t(lang, "loyaltySaveFailed")}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {programConfigured && !programEnabled ? (
                  <p className="mt-3 text-sm font-medium text-muted-foreground">
                    {t(lang, "loyaltyNotEnabledHint")}
                  </p>
                ) : null}

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <StatCard
                    label={t(lang, "loyaltyMembersStat")}
                    value={String(overview.membersActive)}
                    tone="accent"
                  />
                  <StatCard label={t(lang, "loyaltyPointsIssuedStat")} value={String(overview.pointsIssued)} />
                </div>

                <p className="mt-4 text-sm font-medium text-muted-foreground">
                  {overview.program
                    ? t(lang, "loyaltyEarnRuleSummary")
                        .replace("{unit}", String(overview.program.earnUnitUgx))
                        .replace("{points}", String(overview.program.earnPointsPerUnit))
                    : t(lang, "loyaltyProgramNotSetup")}
                </p>
              </article>

              {/* Allowance + usage, straight from the server's authoritative call. */}
              <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-black text-foreground">
                    {t(lang, "loyaltyAllowanceTitle")}
                  </h2>
                  <span
                    className={clsx(
                      "rounded-full px-3 py-1 text-xs font-black",
                      usage?.loyaltyEnabled
                        ? "bg-success-muted text-success"
                        : "bg-warning-muted text-warning-foreground",
                    )}
                  >
                    {usage?.loyaltyEnabled
                      ? t(lang, "loyaltyAllowanceActive")
                      : t(lang, "loyaltyAllowanceInactive")}
                  </span>
                </div>

                {usage?.loyaltyEnabled ? (
                  <>
                    {usage.tierName || usage.tierCode ? (
                      <p className="mt-2 text-sm font-black text-foreground">
                        {usage.tierName ?? usage.tierCode}
                      </p>
                    ) : null}

                    <p className="mt-3 text-lg font-black text-foreground">
                      {t(lang, "loyaltyAllowanceUsage")
                        .replace("{used}", usage.activeMembers.toLocaleString())
                        .replace("{limit}", usage.memberLimit.toLocaleString())}
                    </p>

                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={clsx(
                          "h-full rounded-full",
                          usage.atLimit ? "bg-destructive" : "bg-waka-600",
                        )}
                        style={{ width: `${Math.min(100, Math.max(0, usage.usagePercent))}%` }}
                      />
                    </div>

                    <p
                      className={clsx(
                        "mt-2 text-sm font-bold",
                        usage.atLimit ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {usage.atLimit
                        ? t(lang, "loyaltyMemberLimitReached")
                        : t(lang, "loyaltyMembersRemaining").replace(
                            "{count}",
                            usage.remaining.toLocaleString(),
                          )}
                    </p>

                    <p className="mt-3 text-sm font-semibold text-foreground">
                      {t(lang, "loyaltyPendingRequestsCount").replace(
                        "{count}",
                        String(usage.pendingRequests),
                      )}
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm font-medium text-muted-foreground">
                    {t(lang, "loyaltyAllowanceInactiveHint")}
                  </p>
                )}
              </article>
            </div>
          ) : null}

          {tab === "settings" ? (
            <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h2 className="text-base font-black text-foreground">{t(lang, "loyaltyEarnRuleTitle")}</h2>
              <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyEarnRuleSub")}</p>

              {!canManage ? (
                <p className="mt-4 rounded-xl bg-muted px-3 py-3 text-sm font-semibold text-foreground">
                  {tTemplate(lang, "loyaltySimpleEarnRule", {
                    points: draft.earnPointsPerUnit,
                    unit: draft.earnUnitUgx.toLocaleString(),
                  })}
                </p>
              ) : (
                <>
                  <p className="mt-4 text-sm font-bold text-foreground">
                    {tTemplate(lang, "loyaltySimpleEarnRule", {
                      points: draft.earnPointsPerUnit,
                      unit: draft.earnUnitUgx.toLocaleString(),
                    })}
                  </p>
                  <label className="mt-4 block text-sm font-bold text-foreground">
                    {t(lang, "loyaltySimpleEarnAmountLabel")}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm font-black text-muted-foreground">UGX</span>
                      <input
                        type="number"
                        min={1}
                        value={draft.earnUnitUgx}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            earnUnitUgx: Number(e.target.value),
                            // Keep simple mode at 1 point per unit unless Advanced is open.
                            earnPointsPerUnit: showEarnAdvanced ? d.earnPointsPerUnit : 1,
                          }))
                        }
                        className="min-h-[48px] w-full max-w-[220px] rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                      />
                    </div>
                  </label>

                  <div className="mt-4 rounded-xl bg-muted px-3 py-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {t(lang, "loyaltyEarnExamplesTitle")}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {earnExamples.map((ex) => (
                        <li key={ex.spend} className="text-sm font-semibold text-foreground">
                          {tTemplate(lang, "loyaltyEarnExampleRow", {
                            spend: ex.spend.toLocaleString(),
                            points: ex.points,
                          })}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p className="mt-3 text-sm font-medium text-muted-foreground">
                    {t(lang, "loyaltyPointsAfterSaleNote")}
                  </p>

                  <div className="mt-4 rounded-2xl border border-dashed border-border p-3">
                    <button
                      type="button"
                      onClick={() => setShowEarnAdvanced((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <span className="text-sm font-black text-foreground">{t(lang, "loyaltyAdvancedSettings")}</span>
                      <span className="text-xs font-bold text-muted-foreground">
                        {showEarnAdvanced ? t(lang, "loyaltyHideAdvanced") : t(lang, "loyaltyShowAdvanced")}
                      </span>
                    </button>
                    {showEarnAdvanced ? (
                      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="block text-sm font-bold text-foreground">
                          {t(lang, "loyaltyPointsPerUnitLabel")}
                          <input
                            type="number"
                            min={1}
                            value={draft.earnPointsPerUnit}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, earnPointsPerUnit: Number(e.target.value) }))
                            }
                            className="mt-2 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                          />
                        </label>
                        <label className="block text-sm font-bold text-foreground">
                          {t(lang, "loyaltyMinSpendLabel")}
                          <input
                            type="number"
                            min={0}
                            value={draft.minEligibleSpendUgx}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, minEligibleSpendUgx: Number(e.target.value) }))
                            }
                            className="mt-2 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 rounded-2xl border border-border bg-muted/40 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {t(lang, "loyaltyPointsExpiryTitle")}
                    </p>
                    <p className="mt-2 text-sm font-bold text-foreground">{t(lang, "loyaltyPointsExpiry")}</p>
                    <div className="mt-3 space-y-2">
                      <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <input
                          type="radio"
                          name="pointsExpiryMode"
                          checked={draft.pointsExpiryMode === "never"}
                          onChange={() =>
                            setDraft((d) => ({
                              ...d,
                              pointsExpiryMode: "never",
                              pointsExpiryMonths: null,
                            }))
                          }
                          className="h-4 w-4 accent-waka-600"
                        />
                        {t(lang, "loyaltyPointsExpiryNever")}
                      </label>
                      <label className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                        <input
                          type="radio"
                          name="pointsExpiryMode"
                          checked={draft.pointsExpiryMode === "rolling_months"}
                          onChange={() =>
                            setDraft((d) => ({
                              ...d,
                              pointsExpiryMode: "rolling_months",
                              pointsExpiryMonths: d.pointsExpiryMonths ?? 12,
                            }))
                          }
                          className="h-4 w-4 accent-waka-600"
                        />
                        {t(lang, "loyaltyPointsExpiryAfter")}
                        <input
                          type="number"
                          min={1}
                          step={1}
                          disabled={draft.pointsExpiryMode !== "rolling_months"}
                          value={draft.pointsExpiryMonths ?? ""}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              pointsExpiryMonths:
                                e.target.value === "" ? null : Number(e.target.value),
                            }))
                          }
                          className="min-h-[44px] w-20 rounded-lg border-2 border-border bg-card px-2 text-sm font-semibold disabled:opacity-40"
                        />
                        {t(lang, "loyaltyPointsExpiryMonths")}
                      </label>
                    </div>
                    <p className="mt-3 text-xs font-medium text-muted-foreground">
                      {t(lang, "loyaltyPointsExpiryHint")}
                    </p>
                  </div>

                  <div className="mt-4 rounded-2xl border border-border bg-muted/40 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {t(lang, "loyaltyMembershipTitle")}
                    </p>
                    <p className="mt-2 text-sm font-bold text-foreground">{t(lang, "loyaltyMembershipExpiry")}</p>
                    <div className="mt-3 space-y-2">
                      {(
                        [
                          { mode: "never" as MembershipExpiryMode, label: "loyaltyMembershipNever" },
                          { mode: "fixed_date" as MembershipExpiryMode, label: "loyaltyMembershipFixed" },
                          { mode: "duration" as MembershipExpiryMode, label: "loyaltyMembershipDuration" },
                        ] as const
                      ).map((opt) => (
                        <label key={opt.mode} className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <input
                            type="radio"
                            name="membershipExpiryMode"
                            checked={draft.membershipExpiryMode === opt.mode}
                            onChange={() =>
                              setDraft((d) => ({
                                ...d,
                                membershipExpiryMode: opt.mode,
                                membershipFixedExpiresOn:
                                  opt.mode === "fixed_date"
                                    ? d.membershipFixedExpiresOn ?? new Date().toISOString().slice(0, 10)
                                    : d.membershipFixedExpiresOn,
                                membershipDurationMonths:
                                  opt.mode === "duration"
                                    ? d.membershipDurationMonths ?? 12
                                    : d.membershipDurationMonths,
                              }))
                            }
                            className="h-4 w-4 accent-waka-600"
                          />
                          {t(lang, opt.label)}
                        </label>
                      ))}
                    </div>
                    {draft.membershipExpiryMode === "fixed_date" ? (
                      <label className="mt-3 block text-sm font-bold text-foreground">
                        {t(lang, "loyaltyMembershipDate")}
                        <input
                          type="date"
                          value={draft.membershipFixedExpiresOn ?? ""}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              membershipFixedExpiresOn: e.target.value || null,
                            }))
                          }
                          className="mt-2 min-h-[48px] w-full max-w-[240px] rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                        />
                      </label>
                    ) : null}
                    {draft.membershipExpiryMode === "duration" ? (
                      <label className="mt-3 block text-sm font-bold text-foreground">
                        {t(lang, "loyaltyMembershipMonths")}
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={draft.membershipDurationMonths ?? ""}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              membershipDurationMonths:
                                e.target.value === "" ? null : Number(e.target.value),
                            }))
                          }
                          className="mt-2 min-h-[48px] w-full max-w-[160px] rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                        />
                      </label>
                    ) : null}
                    <p className="mt-3 text-xs font-medium text-muted-foreground">
                      {t(lang, "loyaltyMembershipHint")}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <WakaButton
                      type="button"
                      onClick={() => void submitSave()}
                      disabled={saveState === "saving" || inputError != null}
                      className="rounded-2xl"
                    >
                      {t(lang, "loyaltySave")}
                    </WakaButton>
                    <div role="status">
                      {saveState === "done" ? (
                        <span className="text-sm font-bold text-success">{t(lang, "loyaltySaved")}</span>
                      ) : null}
                      {saveState === "error" ? (
                        <span className="text-sm font-bold text-destructive">{t(lang, "loyaltySaveFailed")}</span>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </article>
          ) : null}

          {tab === "members" && shopId ? (
            <div className="space-y-4">
              <CustomerList
                lang={lang}
                shopId={shopId}
                accounts={accounts}
                search={search}
                searchDone={searchDone}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                expandedId={expandedId}
                canManage={canManage}
                canRedeem={canRedeem}
                canIssueWallet={canIssueWallet}
                mode="full"
                onSearchChange={(value) => {
                  setSearch(value);
                  setSearchDone(false);
                }}
                onToggle={(accountId) =>
                  setExpandedId((id) => (id === accountId ? null : accountId))
                }
                onAdjusted={refreshLists}
              />
              <LoyaltyEnrollmentPanel lang={lang} shopId={shopId} onEnrollmentChanged={refreshLists} />
            </div>
          ) : null}

          {tab === "rewards" ? (
            canManage && shopId ? (
              <>
                <LoyaltyRewardsPanel lang={lang} shopId={shopId} onChanged={refreshLists} />
                {/* Phase G — spend-threshold promotions. Same tab, same authorization, same
                    lifecycle vocabulary as rewards: this is an extension of the merchant's
                    loyalty management, not a second system. */}
                <div className="mt-6">
                  <LoyaltySpendPromotionsPanel lang={lang} shopId={shopId} canManage={canManage} />
                </div>
              </>
            ) : (
              <p className="rounded-2xl bg-muted px-4 py-6 text-center text-sm font-bold text-muted-foreground">
                {t(lang, "loyaltyRewardsOwnerOnly")}
              </p>
            )
          ) : null}

          {tab === "activity" ? (
            <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <h2 className="text-base font-black text-foreground">{t(lang, "loyaltyActivityTitle")}</h2>
              <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyActivitySub")}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatCard
                  label={t(lang, "loyaltyPointsIssuedStat")}
                  value={String(overview.pointsIssued)}
                  tone="accent"
                />
                <StatCard
                  label={t(lang, "loyaltyActivityPointsRedeemed")}
                  value={String(overview.pointsRedeemed)}
                />
                <StatCard
                  label={t(lang, "loyaltyActivityPointsReversed")}
                  value={String(overview.pointsReversed)}
                />
              </div>
              <div className="mt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {t(lang, "loyaltyActivityRecentTitle")}
                </p>
                <div className="mt-2">
                  {overview.recentActivity.length === 0 ? (
                    <p className="py-3 text-sm font-medium text-muted-foreground">
                      {t(lang, "loyaltyActivityEmpty")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {overview.recentActivity.map((row) => (
                        <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-foreground">
                              {row.customerName}
                              <span className="font-medium text-muted-foreground">
                                {" · "}
                                {kindLabel(lang, row.kind)}
                              </span>
                              {row.note ? (
                                <span className="font-medium text-muted-foreground"> — {row.note}</span>
                              ) : null}
                            </p>
                            <p className="text-xs font-medium text-muted-foreground">
                              {formatDateTime(lang, row.createdAt)}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p
                              className={clsx(
                                "text-sm font-black",
                                row.points > 0 ? "text-success" : "text-destructive",
                              )}
                            >
                              {row.points > 0 ? "+" : ""}
                              {row.points} {t(lang, "loyaltyPointsUnit")}
                            </p>
                            {row.balanceAfter != null ? (
                              <p className="text-xs font-medium text-muted-foreground">
                                {t(lang, "loyaltyPointsBalanceLabel")}: {row.balanceAfter}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </article>
          ) : null}

          {tab === "cards" && shopId ? (
            <div className="space-y-4">
              <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <h2 className="text-base font-black text-foreground">{t(lang, "loyaltyCardsTitle")}</h2>
                <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyCardsSub")}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm font-medium text-foreground">
                  <li>{t(lang, "loyaltyCardsBulletQr")}</li>
                  <li>{t(lang, "loyaltyCardsBulletWallet")}</li>
                  <li>{t(lang, "loyaltyCardsBulletPoints")}</li>
                </ul>
              </article>
              {/* Permanent public program code (WPL2026001) — read-only, issued server-side. */}
              <LoyaltyProgramCodePanel lang={lang} shopId={shopId} hubPublicCode={overview.publicCode} />
              <LoyaltyPublicEnrollmentPanel lang={lang} shopId={shopId} canManage={canManage} />
              {/* Join queue lives with the join artifacts (poster code + invite link). */}
              {canManage ? (
                <LoyaltyEnrollmentRequestsPanel
                  lang={lang}
                  shopId={shopId}
                  canManage={canManage}
                  usage={usage}
                  onChanged={refreshLists}
                  onOpenMember={(loyaltyAccountId) => {
                    if (!loyaltyAccountId) return;
                    setStatusFilter("all");
                    setSearch("");
                    setExpandedId(loyaltyAccountId);
                    navigate(loyaltySectionPath("members"));
                  }}
                />
              ) : null}
              {canManage ? (
                <LoyaltyCardDesignPanel lang={lang} shopId={shopId} shopName={shopDisplayName} />
              ) : (
                <p className="rounded-2xl bg-muted px-4 py-6 text-center text-sm font-bold text-muted-foreground">
                  {t(lang, "loyaltyDesignOwnerOnly")}
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </LoyaltyShell>
  );
}
