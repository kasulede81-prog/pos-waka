import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { actorHasPermission } from "../lib/actorAuthorization";
import { useSessionActor } from "../context/SessionActorContext";
import { resolveShopCtx } from "../offline/cloudSync";
import { PageHeader } from "../components/layout/PageHeader";
import { BackOfficePageLayout } from "../components/office/BackOfficePageLayout";
import { WakaSwitch } from "../components/enterprise/WakaSwitch";
import { HorizontalTabBar } from "../components/shared/HorizontalTabBar";
import {
  adjustLoyaltyPoints,
  fetchAccountHistory,
  fetchLoyaltyAccountQrToken,
  fetchLoyaltyOverview,
  renewLoyaltyMembership,
  saveLoyaltyProgram,
  searchLoyaltyAccounts,
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
import { LoyaltyGoogleWalletButton } from "../components/loyalty/LoyaltyGoogleWalletButton";
import { LoyaltyCustomerPageShare } from "../components/loyalty/LoyaltyCustomerPageShare";
import { LoyaltyCardDesignPanel } from "../components/loyalty/LoyaltyCardDesignPanel";
import {
  fetchLoyaltyRewards,
  isRewardEligible,
  isRewardUnexpiredClient,
  newRedemptionIdempotencyKey,
  redeemLoyaltyReward,
  type LoyaltyReward,
} from "../lib/loyalty/loyaltyRewards";
import { requestGoogleWalletBalanceSync } from "../lib/loyalty/loyaltyGoogleWallet";
import { usePosStore } from "../store/usePosStore";

type HubTab = "overview" | "earn" | "customers" | "rewards" | "cards" | "design";

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
      <p className="text-sm font-black text-foreground">{t(lang, "loyaltyMemberQrTitle")}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">{t(lang, "loyaltyMemberQrHint")}</p>
      <div className="mt-3 flex justify-center">
        {loadState === "loading" ? (
          <p className="py-6 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyLoading")}</p>
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
  const [showAdjust, setShowAdjust] = useState(false);
  const [renewState, setRenewState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
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
  }, [entry.accountId, entry.membershipActive]);

  const beginRedeem = (rewardId: string) => {
    setRedeemState({ phase: "idle" });
    setPendingRedeem({ rewardId, key: newRedemptionIdempotencyKey() });
  };

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
    if (!Number.isInteger(points) || points === 0 || !adjustNote.trim()) return;
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
    }
  };

  const submitRenew = async () => {
    setRenewState("saving");
    const result = await renewLoyaltyMembership(shopId, entry.accountId, {});
    if (result.ok) {
      setRenewState("done");
      onAdjusted();
    } else {
      setRenewState("error");
    }
  };

  return (
    <div className="mt-3 space-y-4 rounded-2xl border border-border bg-muted/50 p-4">
      <div>
        <p className="text-sm font-black text-foreground">{t(lang, "loyaltyCustomerCardSectionTitle")}</p>
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

      {!entry.membershipActive ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-3">
          <p className="text-sm font-bold text-destructive">{t(lang, "loyaltyMembershipExpired")}</p>
          {canManage ? (
            <button
              type="button"
              onClick={() => void submitRenew()}
              disabled={renewState === "saving"}
              className="min-h-[40px] rounded-xl bg-waka-600 px-3 text-xs font-black text-white disabled:opacity-50"
            >
              {t(lang, "loyaltyMembershipRenew")}
            </button>
          ) : null}
          {renewState === "done" ? (
            <span className="text-sm font-bold text-success">{t(lang, "loyaltyMembershipRenewed")}</span>
          ) : null}
          {renewState === "error" ? (
            <span className="text-sm font-bold text-destructive">{t(lang, "loyaltySaveFailed")}</span>
          ) : null}
        </div>
      ) : null}

      <MemberQrBlock lang={lang} shopId={shopId} accountId={entry.accountId} />

      <LoyaltyCustomerPageShare lang={lang} shopId={shopId} accountId={entry.accountId} />

      <LoyaltyGoogleWalletButton
        lang={lang}
        shopId={shopId}
        accountId={entry.accountId}
        canIssue={canIssueWallet}
      />

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
            <p className="text-sm font-black text-foreground">{t(lang, "loyaltyHistoryTitle")}</p>
            {history === null ? (
              <p className="py-3 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyLoading")}</p>
            ) : (
              <HistoryList lang={lang} rows={history} />
            )}
          </div>

          {canRedeem ? (
            <div className="rounded-2xl border border-border bg-card p-3">
              <p className="text-sm font-black text-foreground">{t(lang, "loyaltyRedeemTitle")}</p>
              {rewards.length === 0 ? (
                <p className="mt-1 text-xs font-medium text-muted-foreground">{t(lang, "loyaltyNoRewards")}</p>
              ) : (
                <ul className="mt-2 divide-y divide-border">
                  {rewards
                    .filter((reward) => reward.active && isRewardUnexpiredClient(reward.expiresOn))
                    .map((reward) => (
                      <li key={reward.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-foreground">{reward.name}</p>
                          <p className="text-xs font-medium text-muted-foreground">
                            {tTemplate(lang, "loyaltyRewardCost", { points: reward.pointsRequired })}
                            {reward.description ? ` · ${reward.description}` : ""}
                          </p>
                        </div>
                        {pendingRedeem?.rewardId === reward.id ? (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void confirmRedeem()}
                              disabled={redeemState.phase === "busy"}
                              className="min-h-[40px] rounded-xl bg-waka-600 px-3 text-xs font-black text-white disabled:opacity-50"
                            >
                              {redeemState.phase === "busy"
                                ? t(lang, "loyaltyLoading")
                                : tTemplate(lang, "loyaltyRedeemConfirm", { points: reward.pointsRequired })}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPendingRedeem(null);
                                setRedeemState({ phase: "idle" });
                              }}
                              className="min-h-[40px] rounded-xl border-2 border-border bg-card px-3 text-xs font-black text-foreground"
                            >
                              {t(lang, "loyaltyCancel")}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => beginRedeem(reward.id)}
                            disabled={!isRewardEligible(reward, entry.balancePoints)}
                            className="min-h-[40px] shrink-0 rounded-xl border-2 border-waka-600 bg-card px-3 text-xs font-black text-waka-700 disabled:opacity-40"
                          >
                            {t(lang, "loyaltyRedeemAction")}
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              )}
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
                  {redeemState.error === "insufficient_points"
                    ? tTemplate(lang, "loyaltyInsufficientPoints", {
                        balance: redeemState.balance ?? entry.balancePoints,
                        required: redeemState.required ?? 0,
                      })
                    : redeemState.error === "redemption_limit_reached"
                      ? t(lang, "loyaltyRedeemLimitReached")
                      : redeemState.error === "reward_expired"
                        ? t(lang, "loyaltyRewardExpiredRedeem")
                        : redeemState.error === "membership_expired"
                          ? t(lang, "loyaltyMembershipExpiredRedeem")
                          : t(lang, "loyaltyRedeemFailed")}
                </p>
              ) : null}
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
                      value={adjustPoints}
                      onChange={(e) => setAdjustPoints(e.target.value)}
                      placeholder="+10 / -50"
                      className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                    />
                    <input
                      value={adjustNote}
                      onChange={(e) => setAdjustNote(e.target.value)}
                      placeholder={t(lang, "loyaltyAdjustNotePlaceholder")}
                      className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void submitAdjust()}
                      disabled={adjustState === "saving"}
                      className="min-h-[44px] rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-50"
                    >
                      {t(lang, "loyaltyAdjustApply")}
                    </button>
                    {adjustState === "done" ? (
                      <span className="text-sm font-bold text-success">{t(lang, "loyaltySaved")}</span>
                    ) : null}
                    {adjustState === "error" ? (
                      <span className="text-sm font-bold text-destructive">
                        {t(lang, "loyaltyAdjustForbidden")}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
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
  onSearchChange: (value: string) => void;
  onToggle: (accountId: string) => void;
  onAdjusted: () => void;
}) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-base font-black text-foreground">
        {mode === "card" ? t(lang, "loyaltyCardsPickCustomer") : t(lang, "loyaltyCustomersTitle")}
      </p>
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t(lang, "loyaltySearchPlaceholder")}
        className="mt-3 min-h-[48px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
      />
      {searchDone && accounts.length === 0 ? (
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          {search.trim() ? t(lang, "loyaltyNoMembersFound") : t(lang, "loyaltyNoMembers")}
        </p>
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
                    {entry.status === "disabled"
                      ? t(lang, "loyaltyCustomerStatusInactive")
                      : t(lang, "loyaltyCustomerStatusActive")}
                    {!entry.membershipActive ? ` · ${t(lang, "loyaltyMembershipExpired")}` : ""}
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
              {!entry.membershipActive && canManage ? (
                <div className="mt-1 flex items-center gap-2 px-2 pb-1">
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        const result = await renewLoyaltyMembership(shopId, entry.accountId, {});
                        if (result.ok) onAdjusted();
                      })();
                    }}
                    className="min-h-[36px] rounded-xl border-2 border-waka-600 bg-card px-3 text-xs font-black text-waka-700"
                  >
                    {t(lang, "loyaltyMembershipRenew")}
                  </button>
                </div>
              ) : null}
              {expandedId === entry.accountId ? (
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
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [draft, setDraft] = useState<ProgramInput>({ ...DEFAULT_LOYALTY_PROGRAM });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<LoyaltyAccountListEntry[]>([]);
  const [searchDone, setSearchDone] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<HubTab>("overview");
  const [showEarnAdvanced, setShowEarnAdvanced] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ctx = await resolveShopCtx();
      if (cancelled) return;
      const id = ctx?.shopId ?? null;
      setShopId(id);
      if (id) await loadOverview(id);
      else setLoadState("error");
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOverview]);

  const runSearch = useCallback(async (id: string, query: string) => {
    const seq = ++searchSeq.current;
    const rows = await searchLoyaltyAccounts(id, query);
    if (seq !== searchSeq.current) return;
    setAccounts(rows);
    setSearchDone(true);
  }, []);

  useEffect(() => {
    if (!shopId || loadState !== "ready") return;
    if (tab !== "customers" && tab !== "cards") return;
    const handle = window.setTimeout(() => void runSearch(shopId, search), 250);
    return () => window.clearTimeout(handle);
  }, [shopId, search, loadState, runSearch, tab]);

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
      void runSearch(shopId, search);
    } else {
      setSaveState("error");
    }
  };

  const tabs = useMemo(
    () => [
      { id: "overview", label: t(lang, "loyaltyTabOverview") },
      { id: "earn", label: t(lang, "loyaltyTabHowPoints") },
      { id: "customers", label: t(lang, "loyaltyTabCustomers") },
      { id: "rewards", label: t(lang, "loyaltyTabRewards") },
      { id: "cards", label: t(lang, "loyaltyTabCards") },
      { id: "design", label: t(lang, "loyaltyTabDesign") },
    ],
    [lang],
  );

  const refreshLists = () => {
    if (!shopId) return;
    void loadOverview(shopId);
    void runSearch(shopId, search);
  };

  return (
    <BackOfficePageLayout
      header={
        <PageHeader
          lang={lang}
          title={t(lang, "loyaltyHubTitle")}
          subtitle={t(lang, "loyaltyHubSub")}
          backFallback="/office"
          backLabel={t(lang, "officeHubTitle")}
          compact
        />
      }
    >
      {loadState === "loading" ? (
        <p className="rounded-2xl bg-muted px-4 py-6 text-center text-sm font-bold text-muted-foreground">
          {t(lang, "loyaltyLoading")}
        </p>
      ) : null}

      {loadState === "error" ? (
        <p className="rounded-2xl bg-warning-muted px-4 py-6 text-center text-sm font-bold text-warning-foreground">
          {t(lang, "loyaltyUnavailable")}
        </p>
      ) : null}

      {loadState === "ready" && overview ? (
        <div className="space-y-4">
          <HorizontalTabBar
            tabs={tabs}
            activeId={tab}
            onChange={(id) => {
              setTab(id as HubTab);
              setExpandedId(null);
            }}
            ariaLabel={t(lang, "loyaltyHubTitle")}
          />

          {tab === "overview" ? (
            <div className="space-y-4">
              <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-base font-black text-foreground">{t(lang, "loyaltyProgramStatusTitle")}</p>
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
                      <button
                        type="button"
                        onClick={() => void submitSave()}
                        disabled={saveState === "saving" || inputError != null}
                        className="min-h-[44px] rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-50"
                      >
                        {t(lang, "loyaltySave")}
                      </button>
                      {saveState === "done" ? (
                        <span className="text-sm font-bold text-success">{t(lang, "loyaltySaved")}</span>
                      ) : null}
                      {saveState === "error" ? (
                        <span className="text-sm font-bold text-destructive">{t(lang, "loyaltySaveFailed")}</span>
                      ) : null}
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
              </article>
            </div>
          ) : null}

          {tab === "earn" ? (
            <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-base font-black text-foreground">{t(lang, "loyaltyEarnRuleTitle")}</p>
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
                          className="min-h-[40px] w-20 rounded-lg border-2 border-border bg-card px-2 text-sm font-semibold disabled:opacity-40"
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
                    <button
                      type="button"
                      onClick={() => void submitSave()}
                      disabled={saveState === "saving" || inputError != null}
                      className="min-h-[48px] rounded-2xl bg-waka-600 px-5 text-sm font-black text-white disabled:opacity-50"
                    >
                      {t(lang, "loyaltySave")}
                    </button>
                    {saveState === "done" ? (
                      <span className="text-sm font-bold text-success">{t(lang, "loyaltySaved")}</span>
                    ) : null}
                    {saveState === "error" ? (
                      <span className="text-sm font-bold text-destructive">{t(lang, "loyaltySaveFailed")}</span>
                    ) : null}
                  </div>
                </>
              )}
            </article>
          ) : null}

          {tab === "customers" && shopId ? (
            <div className="space-y-4">
              <CustomerList
                lang={lang}
                shopId={shopId}
                accounts={accounts}
                search={search}
                searchDone={searchDone}
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
              <LoyaltyRewardsPanel lang={lang} shopId={shopId} onChanged={refreshLists} />
            ) : (
              <p className="rounded-2xl bg-muted px-4 py-6 text-center text-sm font-bold text-muted-foreground">
                {t(lang, "loyaltyRewardsOwnerOnly")}
              </p>
            )
          ) : null}

          {tab === "cards" && shopId ? (
            <div className="space-y-4">
              <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-base font-black text-foreground">{t(lang, "loyaltyCardsTitle")}</p>
                <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyCardsSub")}</p>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm font-medium text-foreground">
                  <li>{t(lang, "loyaltyCardsBulletQr")}</li>
                  <li>{t(lang, "loyaltyCardsBulletWallet")}</li>
                  <li>{t(lang, "loyaltyCardsBulletPoints")}</li>
                </ul>
              </article>
              <CustomerList
                lang={lang}
                shopId={shopId}
                accounts={accounts}
                search={search}
                searchDone={searchDone}
                expandedId={expandedId}
                canManage={canManage}
                canRedeem={canRedeem}
                canIssueWallet={canIssueWallet}
                mode="card"
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

          {tab === "design" ? (
            canManage && shopId ? (
              <LoyaltyCardDesignPanel lang={lang} shopId={shopId} shopName={shopDisplayName} />
            ) : (
              <p className="rounded-2xl bg-muted px-4 py-6 text-center text-sm font-bold text-muted-foreground">
                {t(lang, "loyaltyDesignOwnerOnly")}
              </p>
            )
          ) : null}
        </div>
      ) : null}
    </BackOfficePageLayout>
  );
}
