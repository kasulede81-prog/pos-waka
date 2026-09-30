import { useCallback, useEffect, useState } from "react";
import { WakaPosLogo } from "../../components/brand/WakaLogo";
import {
  fetchMemberActivity,
  fetchMemberDashboard,
  fetchMemberPromotions,
  fetchMemberRewards,
  type MemberActivityItem,
  type MemberDashboard,
  type MemberLinkedAccount,
  type MemberPromotion,
  type MemberReward,
} from "../../lib/memberDashboard";
import { LoyaltyCodeEntryForm } from "../../components/loyalty/LoyaltyCodeEntryForm";
import { MemberGoogleWalletButton } from "../../components/loyalty/MemberGoogleWalletButton";
import { useMemberEnrollmentStatus } from "../../hooks/useMemberEnrollmentStatus";
import { useAuth } from "../../hooks/useAuth";

/**
 * The authenticated WAKA Loyalty member home.
 *
 * ONE DATA SOURCE. Everything here comes from `fetchMemberDashboard()` — the
 * `loyalty_member_dashboard()` projection. That function takes NO parameters and resolves the member
 * from `auth.uid()` alone, so cross-member access is structurally impossible rather than merely
 * checked, and the browser never reads `loyalty_accounts` or `loyalty_member_links` directly.
 *
 * NOTHING IS INVENTED. The projection returns exactly the accounts the member is linked to, each
 * with its own balance and lifetime figures. That is what is displayed, and nothing else is
 * implied: Activity and Rewards are NOT available to an authenticated member yet (there is no
 * member-scoped read for the points ledger or a shop's reward catalogue), so they are shown as an
 * explicitly labelled "coming next" area rather than being faked or approximated from balances.
 *
 * POINTS ARE PER MERCHANT, NEVER POOLED. Each balance belongs to one shop's account and is
 * redeemable only there. The summary total exists as a convenience and says so; every merchant card
 * repeats its own numbers so the association is never lost.
 *
 * BEARER CREDENTIALS ARE ABSENT BY DESIGN. The projection never returns `public_card_token` or
 * `qr_token` — both are credentials, and the public card token IS the public card URL. This page
 * therefore cannot link to a public card and does not try: it reports only whether one has been
 * issued. The public-card Edge Function is deliberately NOT called from here.
 *
 * "ADD TO GOOGLE WALLET" IS THE ONE WALLET AFFORDANCE, and it does not need a token. It sends
 * the merchant's shop id to the existing `loyalty-wallet-pass` Edge Function with NO account id;
 * the server resolves the member's own account from their session (`auth.uid()` → their active
 * link at that shop) and issues the SAME pass the merchant's own "Send customer their card"
 * issues — same issuer, same published class, same object id, so a card the shop already sent is
 * the same Google Wallet card rather than a duplicate. No `public_card_token` and no `qr_token`
 * is read, returned or stored anywhere on this page.
 *
 * PHASE 2C — THIS PAGE NO LONGER CREATES MEMBERS. A signed-in person with no `loyalty_members` row
 * used to be offered a name/phone registration form right here, which produced a WAKA Loyalty
 * identity belonging to no merchant: no programme, no card, no points, and no way to become useful
 * without enrolling somewhere anyway. The merchant's programme is the context that makes a
 * membership mean something, so it is now required FIRST — this page shows the code-entry step and
 * sends the person to `/j/<code>`, where the join actually happens.
 *
 * The same reasoning covers a member whose links are all gone: they are offered the code step, not
 * a registration form. Nothing on this page creates a member.
 */

/** Display names for the canonical business types; unknown values fall back to the raw value. */
const BUSINESS_TYPE_LABELS: Record<string, string> = {
  kiosk_duka: "Kiosk / Duka",
  wholesale: "Wholesale",
  mini_supermarket: "Mini supermarket",
  hardware: "Hardware",
  hospitality: "Hospitality",
  restaurant: "Restaurant",
  bar: "Bar",
  restaurant_bar: "Restaurant & bar",
  hotel: "Hotel",
  salon: "Salon",
  pharmacy: "Pharmacy",
  boutique: "Boutique",
  electronics: "Electronics",
  produce_market: "Produce market",
  mobile_money_agent: "Mobile money agent",
  other: "Shop",
};

/** Thousands-separated, so a five-digit balance still reads at a glance. Matches the card face. */
function formatPoints(points: number): string {
  const n = Math.max(0, Math.trunc(Number(points) || 0));
  return n.toLocaleString("en-US");
}

/** A date the member can act on, or null when the value is absent or unparseable. */
function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function businessTypeLabel(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  return BUSINESS_TYPE_LABELS[value] ?? value.replace(/_/g, " ");
}

/** True when an expiry date is in the past. Absent expiry means "no expiry", not "expired". */
function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t < Date.now();
}

const POSITIVE_STATUSES = new Set(["active", "enrolled", "approved"]);

function statusTone(status: string): "positive" | "warning" | "muted" {
  if (POSITIVE_STATUSES.has(status.toLowerCase())) return "positive";
  if (status.toLowerCase() === "suspended") return "warning";
  return "muted";
}

function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = statusTone(status);
  const toneClass =
    tone === "positive"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
      : tone === "warning"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-black capitalize ${toneClass}`}
    >
      {label ?? status}
    </span>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-2xl font-black tabular-nums leading-none ${
          accent ? "text-waka-600 dark:text-waka-400" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** Signed points, so the direction of a movement reads at a glance. */
function formatSignedPoints(points: number): string {
  const n = Math.trunc(Number(points) || 0);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatPoints(Math.abs(n))}`;
}

/**
 * What happened, in the member's words. The server returns structure (kind, cause, the
 * purchase total, the reward) and never prose, so the label is composed here and stays
 * translatable.
 */
function activityLabel(item: MemberActivityItem): string {
  switch (item.kind) {
    case "earned":
      return item.saleTotalUgx != null
        ? `Purchase — UGX ${formatPoints(item.saleTotalUgx)}`
        : "Points earned";
    case "redeemed":
      return item.rewardName ? `Reward redeemed — ${item.rewardName}` : "Reward redeemed";
    // Phase D — a redemption the shop reversed. Distinguished from the original redemption
    // above, so a member can see that the points came back rather than silently having a
    // mystery credit appear.
    case "adjusted":
      return item.cause === "redemption_reversal"
        ? item.rewardName
          ? `Redemption reversed — ${item.rewardName}`
          : "Redemption reversed — points returned"
        : "Adjustment";
    case "reversed":
      return item.cause === "void" ? "Sale voided — points reversed" : "Return — points reversed";
    case "expired":
      return "Points expired";
    case "promotional":
      return "Promotional points";
    default:
      return "Points movement";
  }
}

function ActivityRow({ item, showMerchant }: { item: MemberActivityItem; showMerchant: boolean }) {
  const positive = item.points > 0;
  const when = formatDay(item.createdAt);
  return (
    <li className="flex items-start justify-between gap-3 py-2.5" data-testid="member-activity-row">
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold text-foreground">{activityLabel(item)}</p>
        <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
          {/* Merchant identity is never collapsed: a multi-merchant member must be able
              to tell which shop a movement belongs to. */}
          {showMerchant && item.shopName ? `${item.shopName} · ` : ""}
          {when ?? ""}
        </p>
      </div>
      <p
        className={`shrink-0 text-sm font-black tabular-nums ${
          positive ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
        }`}
      >
        {formatSignedPoints(item.points)}
      </p>
    </li>
  );
}

/**
 * A promotion, as the member sees it.
 *
 * Every number here is the SERVER's: the spend, the remainder and whether it has been earned
 * come from `loyalty_member_promotions()`. The progress bar renders those figures — it never
 * decides anything, so it cannot promise a customer a promotion the shop's engine would not pay.
 */
function PromotionCard({ promotion }: { promotion: MemberPromotion }) {
  const progress =
    promotion.thresholdUgx && promotion.thresholdUgx > 0
      ? Math.min(100, Math.round(((promotion.qualifyingSpendUgx ?? 0) / promotion.thresholdUgx) * 100))
      : 0;
  const ends = formatDay(promotion.endsAt);
  const isSpend = promotion.kind === "spend_bonus";

  return (
    <article
      className={`rounded-2xl border p-4 ${
        promotion.rewarded ? "border-emerald-300 bg-card dark:border-emerald-900" : "border-border bg-card"
      }`}
      data-testid="member-promotion-card"
      data-promotion-rewarded={promotion.rewarded}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-black leading-snug text-foreground">{promotion.title}</p>
          {promotion.shopName ? (
            <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">{promotion.shopName}</p>
          ) : null}
        </div>
        {promotion.bonusPoints != null ? (
          <p className="shrink-0 text-sm font-black text-waka-600 dark:text-waka-400">
            +{formatPoints(promotion.bonusPoints)} pts
          </p>
        ) : promotion.multiplier != null ? (
          <p className="shrink-0 text-sm font-black text-waka-600 dark:text-waka-400">
            {Number(promotion.multiplier)}× pts
          </p>
        ) : null}
      </div>

      {isSpend && promotion.thresholdUgx != null ? (
        <div className="mt-3">
          {promotion.rewarded ? (
            <span
              className="inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              data-testid="member-promotion-earned"
            >
              Earned — {formatPoints(promotion.bonusPoints ?? 0)} points added
            </span>
          ) : (
            <>
              <p className="text-xs font-semibold text-foreground">
                Spend UGX {formatPoints(promotion.thresholdUgx)}
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-waka-500" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                UGX {formatPoints(promotion.qualifyingSpendUgx ?? 0)} / UGX {formatPoints(promotion.thresholdUgx)}
                {" · "}
                {formatPoints(promotion.remainingUgx ?? 0)} remaining · {progress}%
              </p>
            </>
          )}
        </div>
      ) : null}

      {promotion.grantedRewardCount != null ? (
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">
          A reward has been unlocked for you.
        </p>
      ) : null}

      {ends ? (
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">Ends {ends}</p>
      ) : null}
    </article>
  );
}

/** How a reward's server-computed state reads to the member. */
function rewardStatusLabel(reward: MemberReward): { text: string; tone: "ready" | "close" | "muted" } {
  switch (reward.state) {
    case "available":
      return { text: "Ready to redeem", tone: "ready" };
    case "insufficient_points":
      return { text: `${formatPoints(reward.pointsNeeded)} more points needed`, tone: "close" };
    case "limit_reached":
      return { text: "Already redeemed the maximum", tone: "muted" };
    case "expired":
      return { text: reward.expiresOn ? `Expired ${formatDay(reward.expiresOn)}` : "Expired", tone: "muted" };
    case "inactive":
      return { text: "No longer offered", tone: "muted" };
    default:
      return { text: "Not available", tone: "muted" };
  }
}

/**
 * One reward. The member is shown what it costs, what they hold at THAT merchant, and
 * whether they qualify — and is told to ask the shop, because redemption is
 * merchant-driven and there is no member redemption path to offer.
 */
function RewardCard({ reward, showMerchant }: { reward: MemberReward; showMerchant: boolean }) {
  const status = rewardStatusLabel(reward);
  const toneClass =
    status.tone === "ready"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
      : status.tone === "close"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
        : "bg-muted text-muted-foreground";
  const progress =
    reward.pointsRequired > 0
      ? Math.min(100, Math.round((reward.balancePoints / reward.pointsRequired) * 100))
      : 0;

  return (
    <article
      className={`rounded-2xl border p-4 ${
        status.tone === "ready" ? "border-emerald-300 bg-card dark:border-emerald-900" : "border-border bg-card"
      }`}
      data-testid="member-reward-card"
      data-reward-state={reward.state}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-black leading-snug text-foreground">{reward.name}</p>
          {showMerchant && reward.shopName ? (
            <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">{reward.shopName}</p>
          ) : null}
          {reward.description ? (
            <p className="mt-1 break-words text-xs font-medium leading-relaxed text-muted-foreground">
              {reward.description}
            </p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-black tabular-nums leading-none text-foreground">
            {formatPoints(reward.pointsRequired)}
          </p>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">points</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${toneClass}`}>
          {status.text}
        </span>
        {reward.personal ? (
          <span className="inline-flex rounded-full bg-waka-100 px-2.5 py-1 text-[11px] font-black text-waka-800 dark:bg-waka-950/50 dark:text-waka-300">
            Just for you
          </span>
        ) : null}
        {reward.timesRedeemed > 0 ? (
          <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
            Redeemed {reward.timesRedeemed}×
          </span>
        ) : null}
      </div>

      {reward.state === "insufficient_points" ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-waka-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            You have {formatPoints(reward.balancePoints)} of {formatPoints(reward.pointsRequired)} points here
          </p>
        </div>
      ) : null}

      {reward.expiresOn && reward.active ? (
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">
          Available until {formatDay(reward.expiresOn)}
        </p>
      ) : null}
      {reward.personal && reward.grantedUntil ? (
        <p className="mt-1 text-[11px] font-medium text-muted-foreground">
          Yours until {formatDay(reward.grantedUntil)}
        </p>
      ) : null}
      {reward.redemptionsRemaining != null && reward.maxRedemptionsPerAccount != null ? (
        <p className="mt-1 text-[11px] font-medium text-muted-foreground">
          {reward.redemptionsRemaining} of {reward.maxRedemptionsPerAccount} left for you
        </p>
      ) : null}
    </article>
  );
}

/** One shop's account. The balance always sits inside the same card as the merchant it belongs to. */
function MerchantCard({ account, prominent }: { account: MemberLinkedAccount; prominent: boolean }) {
  const type = businessTypeLabel(account.shopBusinessType);
  const place = [type, account.shopDistrict].filter(Boolean).join(" · ");
  const expiry = formatDay(account.membershipExpiresAt);
  const enrolled = formatDay(account.enrolledAt);
  const expired = isExpired(account.membershipExpiresAt);
  /** The same condition the server enforces before it will issue a pass. */
  const usable = statusTone(account.accountStatus) === "positive" && !expired;

  return (
    <article
      data-testid="member-merchant-card"
      className={`rounded-2xl border border-border p-5 ${
        prominent
          ? "bg-gradient-to-br from-waka-50 to-card dark:from-waka-950/40 dark:to-card"
          : "bg-card"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-black leading-snug text-foreground">
            {account.shopName || "WAKA merchant"}
          </p>
          {place ? (
            <p className="mt-0.5 break-words text-xs font-medium text-muted-foreground">{place}</p>
          ) : null}
        </div>
        <StatusPill status={account.accountStatus} />
      </div>

      <div className={prominent ? "mt-5 text-center" : "mt-4"}>
        <p
          className={`font-black tabular-nums leading-none text-foreground ${
            prominent ? "text-5xl" : "text-3xl"
          }`}
        >
          {formatPoints(account.balancePoints)}
        </p>
        <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          Points here
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
        <div>
          <dt className="font-medium text-muted-foreground">Lifetime earned</dt>
          <dd className="font-bold tabular-nums text-foreground">
            {formatPoints(account.lifetimeEarnedPoints)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Lifetime redeemed</dt>
          <dd className="font-bold tabular-nums text-foreground">
            {formatPoints(account.lifetimeRedeemedPoints)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted-foreground">
        {expiry ? (
          <span className={expired ? "font-bold text-amber-700 dark:text-amber-400" : undefined}>
            {expired ? "Membership expired" : "Membership expires"} {expiry}
          </span>
        ) : null}
        {enrolled ? <span>Joined {enrolled}</span> : null}
      </div>

      <p className="mt-3 text-[11px] font-bold text-muted-foreground">
        {account.hasPublicCard ? "Digital card ready" : "Digital card not issued yet"}
      </p>

      {/*
        Add to Google Wallet — THIS merchant's card, for THIS member.
        It issues the same pass the shop's own "Send customer their card" issues (same Edge
        Function, same issuer, same object id), so a card the shop already sent is the same
        Google Wallet card, not a second one. The request carries the shop and nothing else;
        the server resolves the account from the member's session.
        Offered only while the card can actually be used — a suspended, revoked or expired
        account has no pass to add, and the server refuses it anyway.
      */}
      {usable ? <MemberGoogleWalletButton shopId={account.shopId} shopName={account.shopName} /> : null}
    </article>
  );
}

/**
 * The loaded dashboard. Pure and presentational so it can be rendered directly in tests — the
 * page below owns the fetching, the states and the realtime refresh.
 */
export function MemberDashboardView({
  dashboard,
  activity = [],
  activityState = "ready",
  activityHasMore = false,
  onLoadMoreActivity,
  promotions = [],
  rewards = [],
  rewardsState = "ready",
}: {
  dashboard: MemberDashboard;
  activity?: MemberActivityItem[];
  activityState?: "loading" | "ready" | "error";
  activityHasMore?: boolean;
  onLoadMoreActivity?: () => void;
  rewards?: MemberReward[];
  promotions?: MemberPromotion[];
  rewardsState?: "loading" | "ready" | "error";
}) {
  const { member, accounts, counts } = dashboard;

  const activeAccounts = accounts.filter((a) => statusTone(a.accountStatus) === "positive");
  const sum = (pick: (a: MemberLinkedAccount) => number) =>
    activeAccounts.reduce((total, a) => total + (Number(pick(a)) || 0), 0);

  const memberSince = formatDay(member.memberSince);
  const merchantWord = counts.linkedAccounts === 1 ? "merchant" : "merchants";

  return (
    <div className="flex flex-col gap-5" data-testid="member-dashboard">
      {/* Identity — who this account belongs to, and that it is in good standing. */}
      <section
        className="rounded-2xl border border-border bg-card p-5"
        data-testid="member-identity"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Member
            </p>
            <p className="mt-1 break-words text-xl font-black leading-tight text-foreground">
              {member.displayName || "WAKA member"}
            </p>
            {member.phoneMasked ? (
              <p className="mt-1 text-sm font-semibold tabular-nums text-muted-foreground">
                {member.phoneMasked}
              </p>
            ) : null}
          </div>
          <StatusPill status={member.status} />
        </div>
        <p className="mt-4 text-[11px] font-medium text-muted-foreground">
          {memberSince ? `Member since ${memberSince}` : "WAKA Loyalty member"}
          {" · "}
          {counts.linkedAccounts} linked {merchantWord}
        </p>
      </section>

      {accounts.length === 0 ? (
        /* A member with nothing linked yet — the same code step as everywhere else, because the
           merchant programme is what makes a membership mean something. */
        <section
          className="rounded-2xl border border-border bg-card p-5"
          data-testid="member-no-merchants"
        >
          <p className="text-base font-black text-foreground">No merchants yet</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Enter a WAKA Loyalty code from a shop to join their programme. Your points and card
            appear here once the shop approves you.
          </p>
          <div className="mt-4">
            <LoyaltyCodeEntryForm />
          </div>
        </section>
      ) : (
        <>
          {/* Summary — a convenience view. Each balance stays separate and is repeated below. */}
          <section className="flex flex-col gap-2" data-testid="member-summary">
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Total points" value={formatPoints(sum((a) => a.balancePoints))} accent />
              <StatTile label="Merchants" value={String(counts.linkedAccounts)} />
              <StatTile label="Lifetime earned" value={formatPoints(sum((a) => a.lifetimeEarnedPoints))} />
              <StatTile
                label="Lifetime redeemed"
                value={formatPoints(sum((a) => a.lifetimeRedeemedPoints))}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Across your active merchants. Points are held by each merchant separately — they are
              never combined into one balance, and they are redeemed where you earned them.
            </p>
          </section>

          <section className="flex flex-col gap-3" data-testid="member-merchants">
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">
              {accounts.length === 1 ? "Your loyalty card" : "Your merchants"}
            </h2>
            {accounts.map((account) => (
              <MerchantCard
                key={account.linkId}
                account={account}
                prominent={accounts.length === 1}
              />
            ))}
          </section>

          {/* The member's own points history, across every merchant they are linked to. */}
          <section className="rounded-2xl border border-border bg-card p-5" data-testid="member-activity">
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">
              Activity
            </h2>

            {activityState === "loading" ? (
              <div className="mt-3 flex flex-col gap-3" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="h-3 w-40 rounded-full waka-skeleton-bar" />
                    <div className="h-3 w-10 rounded-full waka-skeleton-bar" />
                  </div>
                ))}
              </div>
            ) : activityState === "error" ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                We could not load your points history. Pull to refresh, or try again shortly.
              </p>
            ) : activity.length === 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                No points activity yet. Points appear here as soon as a shop awards them.
              </p>
            ) : (
              <>
                <ul className="mt-1 divide-y divide-border" data-testid="member-activity-list">
                  {activity.map((item) => (
                    <ActivityRow
                      key={item.id}
                      item={item}
                      showMerchant={counts.linkedAccounts > 1}
                    />
                  ))}
                </ul>
                {activityHasMore ? (
                  <button
                    type="button"
                    onClick={onLoadMoreActivity}
                    data-testid="member-activity-more"
                    className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-border px-4 text-xs font-black text-foreground active:scale-[0.99]"
                  >
                    Show earlier activity
                  </button>
                ) : null}
              </>
            )}
          </section>

          {/* Promotions running for this member, straight from the server projection. */}
          {promotions.length > 0 ? (
            <section className="flex flex-col gap-3" data-testid="member-promotions">
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">
                Promotions
              </h2>
              {promotions.map((promotion) => (
                <PromotionCard key={`${promotion.shopId}-${promotion.title}`} promotion={promotion} />
              ))}
            </section>
          ) : null}

          {/* What the member's points can actually get them, per merchant. Redemption
              itself stays at the counter — see the note in the section footer. */}
          <section className="flex flex-col gap-3" data-testid="member-rewards">
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">
              Rewards
            </h2>

            {rewardsState === "loading" ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                {[0, 1].map((i) => (
                  <div key={i} className="rounded-2xl border border-border bg-card p-4">
                    <div className="h-3 w-32 rounded-full waka-skeleton-bar" />
                    <div className="mt-3 h-2.5 w-48 rounded-full waka-skeleton-bar" />
                  </div>
                ))}
              </div>
            ) : rewardsState === "error" ? (
              <p className="rounded-2xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
                We could not load your rewards. Your balances above are unaffected — try again
                shortly.
              </p>
            ) : rewards.length === 0 ? (
              <p
                className="rounded-2xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground"
                data-testid="member-rewards-empty"
              >
                No rewards are available to you yet. As you earn points, the rewards you can redeem
                will appear here.
              </p>
            ) : (
              <>
                {rewards.map((reward) => (
                  <RewardCard
                    key={reward.id}
                    reward={reward}
                    showMerchant={counts.linkedAccounts > 1}
                  />
                ))}
                {!rewards.some((r) => r.state === "available") ? (
                  <p
                    className="text-[11px] leading-relaxed text-muted-foreground"
                    data-testid="member-rewards-none-eligible"
                  >
                    Nothing is ready to redeem just yet — keep earning and check back.
                  </p>
                ) : null}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Rewards are redeemed by the shop at checkout, so show them your points when you
                  pay.
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export function MemberHomePage() {
  const { user, signOut } = useAuth();
  /** The member's own identity card: collapsed by default so the dashboard leads. */
  const [accountOpen, setAccountOpen] = useState(false);
  const displayName = String(
    (user?.user_metadata as { full_name?: string; name?: string } | undefined)?.full_name ??
      (user?.user_metadata as { name?: string } | undefined)?.name ??
      "",
  ).trim();
  /** Display only — the identity classification authority is untouched by this. */
  const signedInWithGoogle =
    String((user?.app_metadata as { provider?: string } | undefined)?.provider ?? "") === "google";
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; data: MemberDashboard } | { kind: "error"; error: string }
  >({ kind: "loading" });

  const load = useCallback(async () => {
    const r = await fetchMemberDashboard();
    return r.ok ? ({ kind: "ready", data: r.data } as const) : ({ kind: "error", error: r.error } as const);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  /**
   * Activity is a SECOND, independently-resolved read. It is deliberately not folded into
   * the dashboard projection: the projection is versioned and shipped, and a failure to
   * load history must never blank out the member's balances.
   */
  const [activity, setActivity] = useState<MemberActivityItem[]>([]);
  const [activityState, setActivityState] = useState<"loading" | "ready" | "error">("loading");
  const [activityCursor, setActivityCursor] = useState<{ before: string | null; beforeId: string | null } | null>(null);
  const [activityMoreBusy, setActivityMoreBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchMemberActivity().then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setActivityState("error");
        return;
      }
      setActivity(r.data.items);
      setActivityCursor({ before: r.data.nextBefore, beforeId: r.data.nextBeforeId });
      setActivityState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activityHasMore = activityState === "ready" && activityCursor?.before != null;
  /** Rewards are a THIRD independent read, for the same reason activity is a second one. */
  /** Promotions are a fourth independent read, on the same principle as the others. */
  const [promotions, setPromotions] = useState<MemberPromotion[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchMemberPromotions().then((r) => {
      if (cancelled || !r.ok) return; // a failure here hides nothing else on the page
      setPromotions(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [rewards, setRewards] = useState<MemberReward[]>([]);
  const [rewardsState, setRewardsState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    void fetchMemberRewards().then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setRewardsState("error");
        return;
      }
      setRewards(r.data.rewards);
      setRewardsState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMoreActivity = useCallback(async () => {
    if (!activityCursor?.before || activityMoreBusy) return;
    setActivityMoreBusy(true);
    try {
      const r = await fetchMemberActivity(activityCursor);
      if (r.ok) {
        // Append: the server pages strictly backwards, so a repeated key cannot collide.
        setActivity((prev) => [...prev, ...r.data.items]);
        setActivityCursor({ before: r.data.nextBefore, beforeId: r.data.nextBeforeId });
      }
    } finally {
      setActivityMoreBusy(false);
    }
  }, [activityCursor, activityMoreBusy]);

  const isMember = state.kind === "ready";

  /**
   * Phase 2D — the member's own enrollment requests, kept current by Realtime.
   *
   * Only enabled for an actual member: a non-member has no requests, and `/member` is also reached
   * by people who have not joined anything yet.
   */
  const { state: enrollment, refresh: refreshEnrollment } = useMemberEnrollmentStatus(isMember);

  /**
   * An approval creates a `loyalty_member_links` row, and the DASHBOARD is what reports links — not
   * the enrollment status. So when the status turns "approved" this re-reads the authoritative
   * member state and waits for the link to actually appear before showing the dashboard. The
   * realtime event told us something changed; only this read says what is true.
   */
  const hasLinkedAccounts = state.kind === "ready" && state.data.counts.linkedAccounts > 0;
  useEffect(() => {
    if (enrollment.kind !== "approved" || hasLinkedAccounts) return;
    let cancelled = false;
    void refreshEnrollment();
    void load().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [enrollment.kind, hasLinkedAccounts, load, refreshEnrollment]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    void load().then(setState);
  }, [load]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <WakaPosLogo size="sm" className="h-10" />
        <h1 className="text-2xl font-black tracking-tight text-foreground">WAKA Loyalty</h1>
        <p className="text-sm font-medium text-muted-foreground">Your member account</p>
      </header>

      {/*
        Account — the member's own identity and a way out.
        Before this, a signed-in customer had NO way to sign out anywhere in the member app:
        every logout entry point belonged to the merchant surface. This uses the SAME
        `useAuth().signOut` the rest of WAKA uses (the single local-first logout, which also
        drops the cached identity classification so the next session re-resolves). No second
        authentication system, and nothing here reaches a merchant surface.
      */}
      {user ? (
        <section className="rounded-2xl border border-border bg-card" data-testid="member-account">
          <button
            type="button"
            onClick={() => setAccountOpen((open) => !open)}
            aria-expanded={accountOpen}
            data-testid="member-account-toggle"
            className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left"
          >
            <span className="min-w-0">
              <span className="block text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Account
              </span>
              <span className="block truncate text-sm font-black text-foreground">
                {displayName || user.email}
              </span>
            </span>
            <span className="shrink-0 text-xs font-black text-muted-foreground">
              {accountOpen ? "Hide" : "Show"}
            </span>
          </button>

          {accountOpen ? (
            <dl className="flex flex-col gap-2 border-t border-border px-4 py-4 text-sm">
              {displayName ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="truncate font-semibold text-foreground">{displayName}</dd>
                </div>
              ) : null}
              {user.email ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="truncate font-semibold text-foreground">{user.email}</dd>
                </div>
              ) : null}
              {signedInWithGoogle ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Sign-in</dt>
                  <dd className="font-semibold text-foreground">Google</dd>
                </div>
              ) : null}
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => void signOut()}
                  data-testid="member-sign-out"
                  className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-border px-4 text-sm font-black text-foreground active:scale-[0.99]"
                >
                  Sign out
                </button>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}

      {state.kind === "loading" ? (
        /* Skeleton rather than a bare line of text: the shape of the account is already known, so
           the page does not jump when the read lands. */
        <div className="flex flex-col gap-5" data-testid="member-loading" aria-busy="true">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="h-3 w-16 rounded-full waka-skeleton-bar" />
            <div className="mt-3 h-6 w-40 rounded-full waka-skeleton-bar" />
            <div className="mt-3 h-4 w-28 rounded-full waka-skeleton-bar" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[74px] rounded-2xl border border-border bg-card p-4">
                <div className="h-2.5 w-16 rounded-full waka-skeleton-bar" />
                <div className="mt-3 h-6 w-20 rounded-full waka-skeleton-bar" />
              </div>
            ))}
          </div>
          <div className="h-40 rounded-2xl border border-border bg-card" />
          <span className="sr-only">Loading your account…</span>
        </div>
      ) : state.kind === "error" && state.error === "not_a_member" ? (
        /* Not a member yet. Deliberately NOT a registration form — see the note at the top of the
           file. Nothing here creates a `loyalty_members` row; the code leads to the join, and the
           join is the only place a member is created. */
        <section className="rounded-2xl border border-border bg-card p-5" data-testid="member-not-a-member">
          <LoyaltyCodeEntryForm
            title="Join WAKA Loyalty"
            subtitle="Enter a merchant's Loyalty code to get started."
          />
        </section>
      ) : state.kind === "error" ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-center" data-testid="member-error">
          <p className="text-sm font-bold text-foreground">We could not load your member account.</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Check your connection and try again. Nothing was changed.
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-waka-600 px-5 text-sm font-black text-white active:scale-[0.99]"
          >
            Try again
          </button>
        </div>
      ) : !hasLinkedAccounts && enrollment.kind === "pending" ? (
        /* The member has joined but the merchant has not reviewed them yet. Without this the page
           showed an empty account and the customer reasonably concluded the join had failed. */
        <section
          className="rounded-2xl border border-border bg-card p-5 text-center"
          data-testid="member-enrollment-pending"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-600" aria-hidden />
          </div>
          <p className="mt-3 text-base font-black text-foreground">Waiting for merchant approval</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{enrollment.request.shopName}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Your request has been sent. This updates on its own — you do not need to refresh.
          </p>
          {enrollment.request.requestedAt ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Submitted {new Date(enrollment.request.requestedAt).toLocaleString()}
            </p>
          ) : null}
        </section>
      ) : !hasLinkedAccounts && enrollment.kind === "rejected" ? (
        /* The request was not approved. The history is kept server-side; the customer is offered
           the code step again rather than being left at a dead end. */
        <section className="flex flex-col gap-4" data-testid="member-enrollment-rejected">
          <div className="rounded-2xl border border-border bg-card p-5 text-center">
            <p className="text-base font-black text-foreground">Request not approved</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{enrollment.request.shopName}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              That shop did not approve your request. You can try another WAKA Loyalty code.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <LoyaltyCodeEntryForm />
          </div>
        </section>
      ) : (
        <MemberDashboardView
          dashboard={state.data}
          activity={activity}
          activityState={activityState}
          activityHasMore={activityHasMore}
          rewards={rewards}
          promotions={promotions}
          rewardsState={rewardsState}
          onLoadMoreActivity={() => void loadMoreActivity()}
        />
      )}
    </div>
  );
}

export default MemberHomePage;
