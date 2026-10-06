import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Globe, ChevronDown } from "lucide-react";
import QRCode from "qrcode";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { languageToggleLabel, nextLanguage } from "../../lib/language";
import {
  activityRangeBounds,
  formatDay,
  formatDateTime,
  type ActivityRange,
} from "../../lib/loyalty/memberDates";
import { encodeLoyaltyQrPayload } from "../../lib/loyalty/loyaltyEnrollment";
import { resolveLoyaltyPresentation } from "../../lib/loyalty/loyaltyCardDesign";
import { WakaLoyaltyCard } from "../../components/loyalty/WakaLoyaltyCard";
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
 * The authenticated DKASU Loyalty member home.
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
 * used to be offered a name/phone registration form right here, which produced a DKASU Loyalty
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

/*
 * Phase A — dates follow the selected language (en-GB / en-UG / sw-KE). The helpers
 * live in src/lib/loyalty/memberDates.ts since Phase B, so the wallet button on the
 * same dashboard formats dates identically.
 */

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

/* Phase C — Activity Center filter vocabulary (audit §9/§23). */
const ACTIVITY_RANGES: { id: ActivityRange; key: string }[] = [
  { id: "all", key: "activityAll" },
  { id: "today", key: "activityToday" },
  { id: "week", key: "activityWeek" },
  { id: "month", key: "activityMonth" },
  { id: "custom", key: "activityCustom" },
];

const ACTIVITY_KINDS = [
  "earned",
  "redeemed",
  "reversed",
  "expired",
  "adjusted",
  "promotional",
] as const;

const ACTIVITY_KIND_KEYS: Record<(typeof ACTIVITY_KINDS)[number], string> = {
  earned: "activityKindEarned",
  redeemed: "activityKindRedeemed",
  reversed: "activityKindReversed",
  expired: "activityKindExpired",
  adjusted: "activityKindAdjusted",
  promotional: "activityKindPromotional",
};

/** Raw filter widget state; the server-bound filter is derived from it. */
export type MemberActivityFilters = {
  range: ActivityRange;
  from: string;
  to: string;
  shopId: string;
  kind: string;
};

/**
 * Phase C — group already-filtered rows into local calendar days with member-facing
 * headings (Today / Yesterday / the formatted date). Pure: labels come from the keys,
 * grouping from the local date of each row.
 */
function activityDayGroups(
  items: MemberActivityItem[],
  lang: Language,
): { key: string; label: string; items: MemberActivityItem[] }[] {
  const now = new Date();
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups: { key: string; label: string; items: MemberActivityItem[] }[] = [];
  for (const item of items) {
    const d = new Date(item.createdAt);
    const key = dayKey(d);
    const label =
      key === todayKey
        ? t(lang, "activityToday")
        : key === yesterdayKey
          ? t(lang, "activityYesterday")
          : (formatDay(item.createdAt, lang) ?? "");
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label, items: [item] });
  }
  return groups;
}

function statusTone(status: string): "positive" | "warning" | "muted" {
  if (POSITIVE_STATUSES.has(status.toLowerCase())) return "positive";
  if (status.toLowerCase() === "suspended") return "warning";
  return "muted";
}

/** Translated status text; unknown statuses fall back to the raw value. */
function statusLabel(status: string, lang: Language): string {
  switch (status.toLowerCase()) {
    case "active":
    case "enrolled":
    case "approved":
      return t(lang, "memberStatusActive");
    case "suspended":
      return t(lang, "memberStatusSuspended");
    case "revoked":
      return t(lang, "memberStatusRevoked");
    case "closed":
      return t(lang, "memberStatusClosed");
    default:
      return status;
  }
}

function StatusPill({ status, lang }: { status: string; lang: Language }) {
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
      {statusLabel(status, lang)}
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
function activityLabel(item: MemberActivityItem, lang: Language): string {
  switch (item.kind) {
    case "earned":
      return item.saleTotalUgx != null
        ? tTemplate(lang, "memberActivityPurchase", { total: formatPoints(item.saleTotalUgx) })
        : t(lang, "memberActivityEarned");
    case "redeemed":
      return item.rewardName
        ? tTemplate(lang, "memberActivityRedeemed", { reward: item.rewardName })
        : t(lang, "memberActivityRedeemedPlain");
    // Phase D — a redemption the shop reversed. Distinguished from the original redemption
    // above, so a member can see that the points came back rather than silently having a
    // mystery credit appear.
    case "adjusted":
      return item.cause === "redemption_reversal"
        ? item.rewardName
          ? tTemplate(lang, "memberActivityRedemptionReversed", { reward: item.rewardName })
          : t(lang, "memberActivityRedemptionReversedPlain")
        : t(lang, "memberActivityAdjustment");
    case "reversed":
      return item.cause === "void"
        ? t(lang, "memberActivityVoid")
        : t(lang, "memberActivityReturn");
    case "expired":
      return t(lang, "memberActivityExpired");
    case "promotional":
      return t(lang, "memberActivityPromo");
    default:
      return t(lang, "memberActivityGeneric");
  }
}

function ActivityRow({
  item,
  showMerchant,
  lang,
}: {
  item: MemberActivityItem;
  showMerchant: boolean;
  lang: Language;
}) {
  const positive = item.points > 0;
  const when = formatDay(item.createdAt, lang);
  return (
    <li className="flex items-start justify-between gap-3 py-2.5" data-testid="member-activity-row">
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold text-foreground">
          {activityLabel(item, lang)}
        </p>
        <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
          {/* Merchant identity is never collapsed: a multi-merchant member must be able
              to tell which shop a movement belongs to. */}
          {showMerchant && item.shopName ? `${item.shopName} · ` : ""}
          {when ?? ""}
        </p>
        {/* Phase C — the resulting balance travels with the row (audit §23). */}
        {item.balanceAfter != null ? (
          <p className="mt-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {t(lang, "loyaltyPointsBalanceLabel")}: {formatPoints(item.balanceAfter)}
          </p>
        ) : null}
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
function PromotionCard({ promotion, lang }: { promotion: MemberPromotion; lang: Language }) {
  const progress =
    promotion.thresholdUgx && promotion.thresholdUgx > 0
      ? Math.min(100, Math.round(((promotion.qualifyingSpendUgx ?? 0) / promotion.thresholdUgx) * 100))
      : 0;
  const ends = formatDay(promotion.endsAt, lang);
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
            +{formatPoints(promotion.bonusPoints)} {t(lang, "publicCardPoints")}
          </p>
        ) : promotion.multiplier != null ? (
          <p className="shrink-0 text-sm font-black text-waka-600 dark:text-waka-400">
            {Number(promotion.multiplier)}× {t(lang, "publicCardPoints")}
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
              {tTemplate(lang, "promotionEarned", {
                points: formatPoints(promotion.bonusPoints ?? 0),
              })}
            </span>
          ) : (
            <>
              <p className="text-xs font-semibold text-foreground">
                {tTemplate(lang, "promotionSpend", {
                  threshold: formatPoints(promotion.thresholdUgx),
                })}
              </p>
              <div
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={promotion.thresholdUgx}
                aria-valuenow={Math.min(
                  promotion.qualifyingSpendUgx ?? 0,
                  promotion.thresholdUgx,
                )}
                aria-label={tTemplate(lang, "promotionSpend", {
                  threshold: formatPoints(promotion.thresholdUgx),
                })}
              >
                <div className="h-full rounded-full bg-waka-500" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                {tTemplate(lang, "promotionProgress", {
                  spent: formatPoints(promotion.qualifyingSpendUgx ?? 0),
                  threshold: formatPoints(promotion.thresholdUgx),
                  remaining: formatPoints(promotion.remainingUgx ?? 0),
                  progress,
                })}
              </p>
            </>
          )}
        </div>
      ) : null}

      {promotion.grantedRewardCount != null ? (
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">
          {t(lang, "promotionUnlocked")}
        </p>
      ) : null}

      {ends ? (
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">
          {tTemplate(lang, "promotionEnds", { date: ends })}
        </p>
      ) : null}
    </article>
  );
}

/** How a reward's server-computed state reads to the member. */
function rewardStatusLabel(
  reward: MemberReward,
  lang: Language,
): { text: string; tone: "ready" | "close" | "muted" } {
  switch (reward.state) {
    case "available":
      return { text: t(lang, "memberRewardReady"), tone: "ready" };
    case "insufficient_points":
      return {
        text: tTemplate(lang, "memberRewardNeeded", {
          points: formatPoints(reward.pointsNeeded),
        }),
        tone: "close",
      };
    case "limit_reached":
      return { text: t(lang, "memberRewardLimit"), tone: "muted" };
    case "expired":
      return {
        text: reward.expiresOn
          ? tTemplate(lang, "memberRewardExpiredOn", {
              date: formatDay(reward.expiresOn, lang) ?? "",
            })
          : t(lang, "memberRewardExpired"),
        tone: "muted",
      };
    case "inactive":
      return { text: t(lang, "memberRewardInactive"), tone: "muted" };
    default:
      return { text: t(lang, "memberRewardUnknown"), tone: "muted" };
  }
}

/**
 * What the reward is worth, rendered only for the benefit kinds the schema actually
 * supports (`none | fixed_discount | percentage_discount`, plus product-backed rewards
 * which deliver the product itself). Nothing is invented here.
 */
function rewardBenefitLabel(
  reward: MemberReward,
  lang: Language,
): string | null {
  if (reward.benefitKind === "fixed_discount" && reward.benefitAmountUgx != null) {
    return tTemplate(lang, "memberBenefitFixed", {
      amount: formatPoints(reward.benefitAmountUgx),
    });
  }
  if (reward.benefitKind === "percentage_discount" && reward.benefitPercent != null) {
    return tTemplate(lang, "memberBenefitPercent", { percent: reward.benefitPercent });
  }
  if (reward.benefitKind === "none" && reward.rewardKind === "product") {
    return t(lang, "memberBenefitProduct");
  }
  return null;
}

/**
 * One reward. The member is shown what it costs, what they hold at THAT merchant, and
 * whether they qualify — and is told to ask the shop, because redemption is
 * merchant-driven and there is no member redemption path to offer.
 */
function RewardCard({
  reward,
  showMerchant,
  lang,
}: {
  reward: MemberReward;
  showMerchant: boolean;
  lang: Language;
}) {
  const status = rewardStatusLabel(reward, lang);
  const benefit = rewardBenefitLabel(reward, lang);
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
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {t(lang, "publicCardPoints")}
          </p>
        </div>
      </div>

      {benefit ? (
        <p className="mt-2 text-sm font-black text-waka-600 dark:text-waka-400" data-testid="member-reward-benefit">
          {benefit}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${toneClass}`}>
          {status.text}
        </span>
        {reward.personal ? (
          <span className="inline-flex rounded-full bg-waka-100 px-2.5 py-1 text-[11px] font-black text-waka-800 dark:bg-waka-950/50 dark:text-waka-300">
            {t(lang, "memberRewardPersonal")}
          </span>
        ) : null}
        {reward.timesRedeemed > 0 ? (
          <span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
            {tTemplate(lang, "memberRewardRedeemedCount", { count: reward.timesRedeemed })}
          </span>
        ) : null}
      </div>

      {reward.state === "insufficient_points" ? (
        <div className="mt-3">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={reward.pointsRequired}
            aria-valuenow={Math.min(reward.balancePoints, reward.pointsRequired)}
            aria-label={t(lang, "memberRewardProgress")}
          >
            <div className="h-full rounded-full bg-waka-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {tTemplate(lang, "memberRewardProgress", {
              have: formatPoints(reward.balancePoints),
              need: formatPoints(reward.pointsRequired),
            })}
          </p>
        </div>
      ) : null}

      {reward.expiresOn && reward.active ? (
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">
          {tTemplate(lang, "memberRewardAvailableUntil", {
            date: formatDay(reward.expiresOn, lang) ?? "",
          })}
        </p>
      ) : null}
      {reward.personal && reward.grantedUntil ? (
        <p className="mt-1 text-[11px] font-medium text-muted-foreground">
          {tTemplate(lang, "memberRewardYoursUntil", {
            date: formatDay(reward.grantedUntil, lang) ?? "",
          })}
        </p>
      ) : null}
      {reward.redemptionsRemaining != null && reward.maxRedemptionsPerAccount != null ? (
        <p className="mt-1 text-[11px] font-medium text-muted-foreground">
          {tTemplate(lang, "memberRewardLeft", {
            remaining: reward.redemptionsRemaining,
            max: reward.maxRedemptionsPerAccount,
          })}
        </p>
      ) : null}
    </article>
  );
}

/** One shop's account. The balance always sits inside the same card as the merchant it belongs to. */
function MerchantCard({
  account,
  prominent,
  lang,
}: {
  account: MemberLinkedAccount;
  prominent: boolean;
  lang: Language;
}) {
  const type = businessTypeLabel(account.shopBusinessType);
  const place = [type, account.shopDistrict].filter(Boolean).join(" · ");
  const expiry = formatDay(account.membershipExpiresAt, lang);
  const enrolled = formatDay(account.enrolledAt, lang);
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
            {account.shopName || t(lang, "memberMerchantFallback")}
          </p>
          {place ? (
            <p className="mt-0.5 break-words text-xs font-medium text-muted-foreground">{place}</p>
          ) : null}
        </div>
        <StatusPill status={account.accountStatus} lang={lang} />
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
          {t(lang, "memberPointsHere")}
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
        <div>
          <dt className="font-medium text-muted-foreground">{t(lang, "memberSummaryEarned")}</dt>
          <dd className="font-bold tabular-nums text-foreground">
            {formatPoints(account.lifetimeEarnedPoints)}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">{t(lang, "memberSummaryRedeemed")}</dt>
          <dd className="font-bold tabular-nums text-foreground">
            {formatPoints(account.lifetimeRedeemedPoints)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-muted-foreground">
        {expiry ? (
          <span className={expired ? "font-bold text-amber-700 dark:text-amber-400" : undefined}>
            {expired
              ? tTemplate(lang, "memberExpiredDate", { date: expiry })
              : tTemplate(lang, "memberExpires", { date: expiry })}
          </span>
        ) : null}
        {enrolled ? (
          <span>{tTemplate(lang, "memberJoined", { date: enrolled })}</span>
        ) : null}
      </div>

      <p className="mt-3 text-[11px] font-bold text-muted-foreground">
        {account.hasPublicCard
          ? t(lang, "memberCardReady")
          : t(lang, "memberCardNotIssued")}
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
      {usable ? (
        <MemberGoogleWalletButton
          shopId={account.shopId}
          shopName={account.shopName}
          lang={lang}
          walletIssuedAt={account.googleWalletIssuedAt}
          walletSyncBalance={account.googleWalletSyncBalance}
          balancePoints={account.balancePoints}
        />
      ) : null}
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
  rewardsTruncated = false,
  cardQr = {},
  activityFilters = { range: "all" as ActivityRange, from: "", to: "", shopId: "", kind: "" },
  onActivityFiltersChange,
  lang,
}: {
  dashboard: MemberDashboard;
  activity?: MemberActivityItem[];
  activityState?: "loading" | "ready" | "error";
  activityHasMore?: boolean;
  onLoadMoreActivity?: () => void;
  rewards?: MemberReward[];
  promotions?: MemberPromotion[];
  rewardsState?: "loading" | "ready" | "error";
  rewardsTruncated?: boolean;
  cardQr?: Record<string, string | null>;
  /** Phase C — raw filter widget state; controls render only when a change handler is given. */
  activityFilters?: MemberActivityFilters;
  onActivityFiltersChange?: (patch: Partial<MemberActivityFilters>) => void;
  lang: Language;
}) {
  const { member, accounts, counts } = dashboard;

  const activeAccounts = accounts.filter((a) => statusTone(a.accountStatus) === "positive");
  const sum = (pick: (a: MemberLinkedAccount) => number) =>
    activeAccounts.reduce((total, a) => total + (Number(pick(a)) || 0), 0);

  const memberSince = formatDay(member.memberSince, lang);

  /** Phase B — premium card faces for accounts the Phase B projection can render. */
  const cardTheme = resolveLoyaltyPresentation(undefined);
  const cardAccounts = accounts.filter(
    (a) => a.memberNumber != null || a.qrToken != null,
  );

  /**
   * Phase D — anchored section chips (audit §26). The dashboard stays ONE scrolling
   * page; the chips only jump within it. Focus moves to the target section so
   * keyboard and screen-reader users land where the jump happened.
   */
  const jumpToSection = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };

  const sectionChipClass =
    "min-h-[44px] rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground transition-colors hover:bg-muted";

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
              {t(lang, "memberLabel")}
            </p>
            <p className="mt-1 break-words text-xl font-black leading-tight text-foreground">
              {member.displayName || t(lang, "memberNameFallback")}
            </p>
            {member.phoneMasked ? (
              <p className="mt-1 text-sm font-semibold tabular-nums text-muted-foreground">
                {member.phoneMasked}
              </p>
            ) : null}
          </div>
          <StatusPill status={member.status} lang={lang} />
        </div>
        <p className="mt-4 text-[11px] font-medium text-muted-foreground">
          {memberSince
            ? tTemplate(lang, "memberSinceLine", { date: memberSince })
            : t(lang, "memberSinceFallback")}
          {" · "}
          {tTemplate(
            lang,
            counts.linkedAccounts === 1 ? "memberLinkedMerchant" : "memberLinkedMerchants",
            { count: counts.linkedAccounts },
          )}
        </p>
      </section>

      {accounts.length === 0 ? (
        /* A member with nothing linked yet — the same code step as everywhere else, because the
           merchant programme is what makes a membership mean something. */
        <section
          className="rounded-2xl border border-border bg-card p-5"
          data-testid="member-no-merchants"
        >
          <p className="text-base font-black text-foreground">{t(lang, "memberNoMerchantsTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t(lang, "memberNoMerchantsBody")}
          </p>
          <div className="mt-4">
            <LoyaltyCodeEntryForm />
          </div>
        </section>
      ) : (
        <>
          {/* Phase D — jump chips for the long scroll (shown once there are enough
              merchants to make scrolling a real cost). One page, anchored. */}
          {accounts.length >= 3 ? (
            <nav
              aria-label={t(lang, "memberChipNav")}
              data-testid="member-section-chips"
              className="flex flex-wrap gap-2"
            >
              <button type="button" onClick={() => jumpToSection("loyalty-memberships")} className={sectionChipClass}>
                {t(lang, "memberChipMembership")}
              </button>
              {cardAccounts.length > 0 ? (
                <button type="button" onClick={() => jumpToSection("loyalty-cards")} className={sectionChipClass}>
                  {t(lang, "memberChipCards")}
                </button>
              ) : null}
              <button type="button" onClick={() => jumpToSection("loyalty-activity")} className={sectionChipClass}>
                {t(lang, "activityTitle")}
              </button>
              {promotions.length > 0 ? (
                <button type="button" onClick={() => jumpToSection("loyalty-promotions")} className={sectionChipClass}>
                  {t(lang, "promotionsTitle")}
                </button>
              ) : null}
              <button type="button" onClick={() => jumpToSection("loyalty-rewards")} className={sectionChipClass}>
                {t(lang, "rewardsTitle")}
              </button>
            </nav>
          ) : null}

          {/* Summary — a convenience view. Each balance stays separate and is repeated below. */}
          <section className="flex flex-col gap-2" data-testid="member-summary">
            <div className="grid grid-cols-2 gap-2">
              <StatTile
                label={t(lang, "memberSummaryTotal")}
                value={formatPoints(sum((a) => a.balancePoints))}
                accent
              />
              <StatTile label={t(lang, "memberSummaryMerchants")} value={String(counts.linkedAccounts)} />
              <StatTile
                label={t(lang, "memberSummaryEarned")}
                value={formatPoints(sum((a) => a.lifetimeEarnedPoints))}
              />
              <StatTile
                label={t(lang, "memberSummaryRedeemed")}
                value={formatPoints(sum((a) => a.lifetimeRedeemedPoints))}
              />
            </div>
            {/* P1-5 — per-merchant breakdown: shows where the aggregate actually lives. */}
            {activeAccounts.length > 1 ? (
              <ul
                className="flex flex-col gap-0.5 text-[11px] font-medium text-muted-foreground"
                data-testid="member-summary-breakdown"
              >
                {activeAccounts.map((account) => (
                  <li key={account.linkId} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">{account.shopName}</span>
                    <span className="shrink-0 font-bold tabular-nums text-foreground">
                      {formatPoints(account.balancePoints)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t(lang, "memberSummaryDisclaimer")}
            </p>
          </section>

          <section
            id="loyalty-memberships"
            tabIndex={-1}
            className="flex flex-col gap-3 focus:outline-none"
            data-testid="member-merchants"
          >
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">
              {accounts.length === 1
                ? t(lang, "memberMerchantsHeadingSingle")
                : t(lang, "memberMerchantsHeading")}
            </h2>
            {accounts.map((account) => (
              <MerchantCard
                key={account.linkId}
                account={account}
                prominent={accounts.length === 1}
                lang={lang}
              />
            ))}
          </section>

          {/*
            Phase B — ONE dashboard holds every merchant's premium digital card
            (audit §22). Same card component as the public share page, fed from the
            member's own projection: derived member number, decorative CVC, own
            qr_token, merchant-defined expiry, per-merchant balance. Rendered only
            when the projection actually returned card identity, so an older server
            simply shows no section instead of a broken card.
          */}
          {cardAccounts.length > 0 ? (
            <section
              id="loyalty-cards"
              tabIndex={-1}
              className="flex flex-col gap-3 focus:outline-none"
              data-testid="member-cards"
            >
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">
                {accounts.length === 1
                  ? t(lang, "memberCardsHeadingSingle")
                  : t(lang, "memberCardsHeading")}
              </h2>
              {cardAccounts.map((account) => (
                <WakaLoyaltyCard
                  key={account.linkId}
                  shopName={account.shopName || t(lang, "memberMerchantFallback")}
                  memberName={member.displayName || t(lang, "memberNameFallback")}
                  memberNumber={account.memberNumber}
                  memberCvc={account.memberCvc}
                  expiresOn={
                    account.membershipExpiresAt
                      ? account.membershipExpiresAt.slice(0, 10)
                      : null
                  }
                  balancePoints={account.balancePoints}
                  theme={cardTheme}
                  qrDataUrl={cardQr[account.linkId] ?? null}
                  lang={lang}
                />
              ))}
            </section>
          ) : null}

          {/* The member's own points history, across every merchant they are linked to. */}
          <section
            id="loyalty-activity"
            tabIndex={-1}
            className="rounded-2xl border border-border bg-card p-5 focus:outline-none"
            data-testid="member-activity"
          >
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">
              {t(lang, "activityTitle")}
            </h2>

            {/* Phase C — Activity Center filters (audit §9/§23). Rendered only when the
                page supplied a change handler; the initial/all state matches the
                pre-Phase-C list exactly. */}
            {onActivityFiltersChange ? (
              <div className="mt-3 flex flex-col gap-3">
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label={t(lang, "activityFiltersLabel")}
                  data-testid="member-activity-filters"
                >
                  {ACTIVITY_RANGES.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={activityFilters.range === option.id}
                      onClick={() => onActivityFiltersChange({ range: option.id })}
                      className={clsx(
                        "min-h-[44px] rounded-xl px-3 text-xs font-black",
                        activityFilters.range === option.id
                          ? "bg-waka-600 text-white"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {t(lang, option.key)}
                    </button>
                  ))}
                </div>

                {activityFilters.range === "custom" ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t(lang, "activityFrom")}
                      <input
                        type="date"
                        value={activityFilters.from}
                        onChange={(e) => onActivityFiltersChange({ from: e.target.value })}
                        aria-label={t(lang, "activityFrom")}
                        className="min-h-[44px] rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t(lang, "activityTo")}
                      <input
                        type="date"
                        value={activityFilters.to}
                        onChange={(e) => onActivityFiltersChange({ to: e.target.value })}
                        aria-label={t(lang, "activityTo")}
                        className="min-h-[44px] rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold"
                      />
                    </label>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-end gap-3">
                  {counts.linkedAccounts > 1 ? (
                    <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t(lang, "activityMerchantLabel")}
                      <select
                        value={activityFilters.shopId}
                        onChange={(e) => onActivityFiltersChange({ shopId: e.target.value })}
                        data-testid="member-activity-merchant"
                        className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold text-foreground"
                      >
                        <option value="">{t(lang, "activityAllMerchants")}</option>
                        {accounts.map((account) => (
                          <option key={account.linkId} value={account.shopId}>
                            {account.shopName}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t(lang, "activityTypeLabel")}
                    <select
                      value={activityFilters.kind}
                      onChange={(e) => onActivityFiltersChange({ kind: e.target.value })}
                      data-testid="member-activity-kind"
                      className="min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold text-foreground"
                    >
                      <option value="">{t(lang, "activityTypeAll")}</option>
                      {ACTIVITY_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {t(lang, ACTIVITY_KIND_KEYS[kind])}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ) : null}

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
                {t(lang, "activityError")}
              </p>
            ) : activity.length === 0 ? (
              <p
                className="mt-2 text-xs leading-relaxed text-muted-foreground"
                data-testid="member-activity-empty"
              >
                {activityFilters.range !== "all" ||
                activityFilters.shopId !== "" ||
                activityFilters.kind !== ""
                  ? t(lang, "activityEmptyFiltered")
                  : t(lang, "activityEmpty")}
              </p>
            ) : (
              <>
                {/* Grouped by local calendar day — headings keep a long window scannable. */}
                <div data-testid="member-activity-list">
                  {activityDayGroups(activity, lang).map((group) => (
                    <div key={group.key} className="mt-3 first:mt-1">
                      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        {group.label}
                      </h3>
                      <ul className="mt-1 divide-y divide-border">
                        {group.items.map((item) => (
                          <ActivityRow
                            key={item.id}
                            item={item}
                            showMerchant={counts.linkedAccounts > 1}
                            lang={lang}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                {activityHasMore ? (
                  <button
                    type="button"
                    onClick={onLoadMoreActivity}
                    data-testid="member-activity-more"
                    className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-border px-4 text-xs font-black text-foreground active:scale-[0.99]"
                  >
                    {t(lang, "activityMore")}
                  </button>
                ) : null}
              </>
            )}
          </section>

          {/* Promotions running for this member, straight from the server projection. */}
          {promotions.length > 0 ? (
            <section
              id="loyalty-promotions"
              tabIndex={-1}
              className="flex flex-col gap-3 focus:outline-none"
              data-testid="member-promotions"
            >
              <h2 className="text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">
                {t(lang, "promotionsTitle")}
              </h2>
              {promotions.map((promotion) => (
                <PromotionCard
                  key={`${promotion.shopId}-${promotion.title}`}
                  promotion={promotion}
                  lang={lang}
                />
              ))}
            </section>
          ) : null}

          {/* What the member's points can actually get them, per merchant. Redemption
              itself stays at the counter — see the note in the section footer. */}
          <section
            id="loyalty-rewards"
            tabIndex={-1}
            className="flex flex-col gap-3 focus:outline-none"
            data-testid="member-rewards"
          >
            <h2 className="text-sm font-black uppercase tracking-[0.14em] text-muted-foreground">
              {t(lang, "rewardsTitle")}
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
                {t(lang, "rewardsError")}
              </p>
            ) : rewards.length === 0 ? (
              <p
                className="rounded-2xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground"
                data-testid="member-rewards-empty"
              >
                {t(lang, "rewardsEmpty")}
              </p>
            ) : (
              <>
                {rewards.map((reward) => (
                  <RewardCard
                    key={reward.id}
                    reward={reward}
                    showMerchant={counts.linkedAccounts > 1}
                    lang={lang}
                  />
                ))}
                {!rewards.some((r) => r.state === "available") ? (
                  <p
                    className="text-[11px] leading-relaxed text-muted-foreground"
                    data-testid="member-rewards-none-eligible"
                  >
                    {t(lang, "rewardsNoneReady")}
                  </p>
                ) : null}
                {rewardsTruncated ? (
                  <p
                    className="text-[11px] font-bold text-amber-700 dark:text-amber-400"
                    data-testid="member-rewards-truncated"
                  >
                    {tTemplate(lang, "rewardsTruncated", { limit: 100 })}
                  </p>
                ) : null}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {t(lang, "rewardsCheckoutNote")}
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export function MemberHomePage({
  lang,
  setLang,
}: {
  lang: Language;
  setLang: (lg: Language) => void;
}) {
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

  /**
   * Phase C — Activity Center filters (audit §9/§23). Widget state lives here; the
   * server-bound filter is derived so the fetch effect re-runs exactly when the
   * filter actually changes (stable object identity via useMemo).
   */
  const [activityFilters, setActivityFilters] = useState<MemberActivityFilters>({
    range: "all",
    from: "",
    to: "",
    shopId: "",
    kind: "",
  });

  const activityFilter = useMemo(() => {
    const bounds = activityRangeBounds(activityFilters.range, activityFilters.from, activityFilters.to);
    return {
      from: bounds.from ?? null,
      to: bounds.to ?? null,
      shopId: activityFilters.shopId || null,
      kind: activityFilters.kind || null,
    };
  }, [activityFilters]);

  /** Event-handler path (lint-safe): flip to loading, then the effect refetches page 1. */
  const changeActivityFilters = useCallback((patch: Partial<MemberActivityFilters>) => {
    setActivityFilters((prev) => ({ ...prev, ...patch }));
    setActivityState("loading");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchMemberActivity(undefined, 20, activityFilter).then((r) => {
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
  }, [activityFilter]);

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
  const [rewardsTruncated, setRewardsTruncated] = useState(false);

  /**
   * Phase B — QR data URLs for the member's OWN card faces, built client-side from
   * the own-account `qr_token` the Phase B projection returns (audit §22 option 1).
   * Same payload helper and encoder options as every other loyalty QR in the app.
   */
  const [cardQr, setCardQr] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (state.kind !== "ready") return;
    const withToken = state.data.accounts.filter((a) => a.qrToken);
    let cancelled = false;
    void (async () => {
      const next: Record<string, string | null> = {};
      for (const account of withToken) {
        try {
          next[account.linkId] = await QRCode.toDataURL(
            encodeLoyaltyQrPayload(account.qrToken ?? ""),
            {
              width: 260,
              margin: 2,
              errorCorrectionLevel: "M",
              color: { dark: "#1c1917", light: "#ffffff" },
            },
          );
        } catch {
          next[account.linkId] = null;
        }
      }
      if (!cancelled) setCardQr(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    void fetchMemberRewards().then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setRewardsState("error");
        return;
      }
      setRewards(r.data.rewards);
      setRewardsTruncated(r.data.truncated);
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
      // Same filters as page 1, so "earlier" continues the filtered window.
      const r = await fetchMemberActivity(activityCursor, 20, activityFilter);
      if (r.ok) {
        // Append: the server pages strictly backwards, so a repeated key cannot collide.
        setActivity((prev) => [...prev, ...r.data.items]);
        setActivityCursor({ before: r.data.nextBefore, beforeId: r.data.nextBeforeId });
      }
    } finally {
      setActivityMoreBusy(false);
    }
  }, [activityCursor, activityMoreBusy, activityFilter]);

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
        {/* Phase A — language control: the same cycling toggle AuthLayout uses, kept
            small so it never dominates the dashboard. Persistence is the shared
            `waka.ui.language` mechanism, so it survives a reload. */}
        <div className="flex w-full justify-end">
          <button
            type="button"
            onClick={() => setLang(nextLanguage(lang))}
            data-testid="member-language-toggle"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-sm active:bg-muted"
          >
            <Globe className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span>{languageToggleLabel(lang)}</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          </button>
        </div>
        <WakaPosLogo size="sm" className="h-10" />
        <h1 className="text-2xl font-black tracking-tight text-foreground">{t(lang, "memberTitle")}</h1>
        <p className="text-sm font-medium text-muted-foreground">{t(lang, "memberSubtitle")}</p>
      </header>

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
          <span className="sr-only">{t(lang, "memberLoadingSr")}</span>
        </div>
      ) : state.kind === "error" && state.error === "not_a_member" ? (
        /* Not a member yet. Deliberately NOT a registration form — see the note at the top of the
           file. Nothing here creates a `loyalty_members` row; the code leads to the join, and the
           join is the only place a member is created. */
        <section className="rounded-2xl border border-border bg-card p-5" data-testid="member-not-a-member">
          <LoyaltyCodeEntryForm
            title={t(lang, "memberJoinTitle")}
            subtitle={t(lang, "memberCodeSubtitle")}
          />
        </section>
      ) : state.kind === "error" ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-center" data-testid="member-error">
          <p className="text-sm font-bold text-foreground">{t(lang, "memberLoadErrorTitle")}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t(lang, "memberLoadErrorBody")}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-waka-600 px-5 text-sm font-black text-white active:scale-[0.99]"
          >
            {t(lang, "memberRetry")}
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
          <p className="mt-3 text-base font-black text-foreground">
            {t(lang, "memberPendingTitle")}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">{enrollment.request.shopName}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t(lang, "memberPendingBody")}
          </p>
          {enrollment.request.requestedAt ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {tTemplate(lang, "memberPendingSubmitted", {
                when:
                  formatDateTime(enrollment.request.requestedAt, lang) ??
                  enrollment.request.requestedAt,
              })}
            </p>
          ) : null}
        </section>
      ) : !hasLinkedAccounts && enrollment.kind === "rejected" ? (
        /* The request was not approved. The history is kept server-side; the customer is offered
           the code step again rather than being left at a dead end. */
        <section className="flex flex-col gap-4" data-testid="member-enrollment-rejected">
          <div className="rounded-2xl border border-border bg-card p-5 text-center">
            <p className="text-base font-black text-foreground">{t(lang, "memberRejectedTitle")}</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{enrollment.request.shopName}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t(lang, "memberRejectedBody")}
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
          rewardsTruncated={rewardsTruncated}
          cardQr={cardQr}
          activityFilters={activityFilters}
          onActivityFiltersChange={changeActivityFilters}
          onLoadMoreActivity={() => void loadMoreActivity()}
          lang={lang}
        />
      )}

      {/*
        Phase A (P1-6) — Account moved BELOW the loyalty content: the customer comes for
        memberships, points, rewards and activity, so account utilities are the last block,
        still collapsible, still the same useAuth().signOut — no session behavior changed.
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
                {t(lang, "memberAccountLabel")}
              </span>
              <span className="block truncate text-sm font-black text-foreground">
                {displayName || user.email}
              </span>
            </span>
            <span className="shrink-0 text-xs font-black text-muted-foreground">
              {accountOpen ? t(lang, "memberHide") : t(lang, "memberShow")}
            </span>
          </button>

          {accountOpen ? (
            <dl className="flex flex-col gap-2 border-t border-border px-4 py-4 text-sm">
              {displayName ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t(lang, "memberAccountName")}</dt>
                  <dd className="truncate font-semibold text-foreground">{displayName}</dd>
                </div>
              ) : null}
              {user.email ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t(lang, "memberAccountEmail")}</dt>
                  <dd className="truncate font-semibold text-foreground">{user.email}</dd>
                </div>
              ) : null}
              {signedInWithGoogle ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t(lang, "memberAccountSignin")}</dt>
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
                  {t(lang, "signOut")}
                </button>
              </div>
            </dl>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default MemberHomePage;
