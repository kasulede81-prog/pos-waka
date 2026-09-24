import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QrCode, X } from "lucide-react";
import type { LoyaltyCheckoutPreview } from "../../hooks/useLoyaltyCheckoutPreview";
import type { LoyaltyAttachState } from "../../hooks/useLoyaltyCheckoutAttach";
import { t, tTemplate } from "../../lib/i18n";
import {
  fetchLoyaltyRewards,
  isProductBackedReward,
  isRewardEligible,
  newRedemptionIdempotencyKey,
  redeemLoyaltyReward,
  type LoyaltyReward,
} from "../../lib/loyalty/loyaltyRewards";
import type { Language } from "../../types";

type Props = {
  lang: Language;
  /** Empty string when no member is attached to the draft sale. */
  customerId: string;
  /** Name to show for the attached member (store draft customer name). */
  customerName: string;
  /** Read-only preview owned by the page, so the post-sale note can reuse it. */
  preview: LoyaltyCheckoutPreview;
  attachState: LoyaltyAttachState;
  onScan: () => void;
  onDetach: () => void;
  /** Camera scanning unavailable on this device — hide the scan action. */
  canScan: boolean;
};

type ClaimPhase =
  | { phase: "idle" }
  | { phase: "busy"; rewardId: string }
  | { phase: "done"; rewardId: string; balance: number }
  | { phase: "error"; rewardId: string; error: string };

/**
 * The checkout loyalty surface (Phases 1–3 + D030 product-backed claim).
 *
 * Product reward claims are online-only: they must run through
 * loyalty_redeem_reward which creates the canonical sale + stock movement.
 * Offline checkout of normal cart sales is unchanged.
 */
export function PosLoyaltyCustomerRow({
  lang,
  customerId,
  customerName,
  preview,
  attachState,
  onScan,
  onDetach,
  canScan,
}: Props) {
  const { shopId, program, account, expectedPoints, fromCache } = preview;
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [claim, setClaim] = useState<ClaimPhase>({ phase: "idle" });
  const claimKeys = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!shopId || !customerId || !account) {
      setRewards([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const rows = await fetchLoyaltyRewards(shopId);
      if (cancelled) return;
      setRewards(rows.filter((r) => isProductBackedReward(r)));
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId, customerId, account?.id, account?.balancePoints]);

  const eligibleProductRewards = useMemo(() => {
    if (!account) return [];
    const balance =
      claim.phase === "done" ? claim.balance : account.balancePoints;
    return rewards.filter((r) => isRewardEligible(r, balance));
  }, [rewards, account, claim]);

  const claimReward = useCallback(
    async (reward: LoyaltyReward) => {
      if (!shopId || !account) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setClaim({ phase: "error", rewardId: reward.id, error: "claim_requires_online" });
        return;
      }
      let key = claimKeys.current.get(reward.id);
      if (!key) {
        key = newRedemptionIdempotencyKey();
        claimKeys.current.set(reward.id, key);
      }
      setClaim({ phase: "busy", rewardId: reward.id });
      const result = await redeemLoyaltyReward(shopId, account.id, reward.id, key);
      if (result.ok) {
        claimKeys.current.delete(reward.id);
        setClaim({ phase: "done", rewardId: reward.id, balance: result.balance });
        // Refresh list / balance via parent preview hook by bumping local list after claim.
        const rows = await fetchLoyaltyRewards(shopId);
        setRewards(rows.filter((r) => isProductBackedReward(r)));
      } else {
        setClaim({ phase: "error", rewardId: reward.id, error: result.error });
      }
    },
    [shopId, account],
  );

  if (!program || !program.enabled) return null;

  const resolving = attachState.status === "resolving";
  const error = attachState.status === "error" ? attachState.errorKey : null;

  const claimErrorLabel = (code: string): string => {
    if (code === "product_out_of_stock") return t(lang, "loyaltyClaimOutOfStock");
    if (code === "insufficient_points") return t(lang, "loyaltyClaimInsufficientPoints");
    if (code === "claim_requires_online") return t(lang, "loyaltyClaimRequiresOnline");
    if (code === "reward_expired") return t(lang, "loyaltyRewardExpiredRedeem");
    if (code === "assignment_expired") return t(lang, "loyaltyClaimAssignmentExpired");
    if (code === "account_suspended" || code === "account_revoked" || code === "account_disabled") {
      return t(lang, "loyaltyClaimAccountBlocked");
    }
    return t(lang, "loyaltyClaimFailed");
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-900">
      {customerId ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-black">{customerName.trim() || t(lang, "loyaltyBalanceLabel")}</span>
          <span>
            {claim.phase === "done"
              ? claim.balance.toLocaleString()
              : account
                ? account.balancePoints.toLocaleString()
                : "—"}{" "}
            {t(lang, "loyaltyPointsUnit")}
          </span>
          {expectedPoints > 0 ? (
            <span className="text-amber-800">
              (+{expectedPoints.toLocaleString()} {t(lang, "loyaltyPointsUnit")}{" "}
              {t(lang, "loyaltyEarnsSuffix")})
            </span>
          ) : null}
          {fromCache ? (
            <span className="text-amber-700/70">({t(lang, "loyaltyOfflineEstimate")})</span>
          ) : null}
          <button
            type="button"
            onClick={onDetach}
            aria-label={t(lang, "loyaltyDetachAction")}
            className="ml-auto flex min-h-[28px] items-center gap-1 rounded-md border border-amber-300 bg-white/70 px-2 py-0.5 text-[10px] font-bold text-amber-900"
          >
            <X aria-hidden className="h-3 w-3" />
            {t(lang, "loyaltyDetachAction")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 flex-1">{t(lang, "loyaltyAttachCustomerHint")}</span>
          {canScan ? (
            <button
              type="button"
              onClick={onScan}
              disabled={resolving}
              className="flex min-h-[32px] items-center gap-1.5 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-black text-amber-900 disabled:opacity-60"
            >
              <QrCode aria-hidden className="h-3.5 w-3.5" />
              {resolving ? t(lang, "loyaltyScanResolving") : t(lang, "loyaltyScanAction")}
            </button>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="mt-1 rounded bg-danger-muted px-1.5 py-0.5 text-[10px] font-bold text-danger">
          {t(lang, error)}
        </p>
      ) : null}

      {customerId && account && eligibleProductRewards.length > 0 ? (
        <div className="mt-1.5 space-y-1 border-t border-amber-200/80 pt-1.5">
          <p className="text-[10px] font-black uppercase tracking-wide text-amber-800">
            {t(lang, "loyaltyCheckoutRewardsTitle")}
          </p>
          {eligibleProductRewards.map((reward) => {
            const busy = claim.phase === "busy" && claim.rewardId === reward.id;
            const done = claim.phase === "done" && claim.rewardId === reward.id;
            const err =
              claim.phase === "error" && claim.rewardId === reward.id ? claim.error : null;
            return (
              <div key={reward.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {reward.name}
                  <span className="ml-1 text-amber-800/80">
                    {reward.pointsRequired} {t(lang, "loyaltyPointsUnit")}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy || done}
                  onClick={() => void claimReward(reward)}
                  className="min-h-[28px] rounded-md border border-amber-400 bg-white px-2 py-0.5 text-[10px] font-black text-amber-900 disabled:opacity-50"
                >
                  {busy
                    ? t(lang, "loyaltyClaimBusy")
                    : done
                      ? t(lang, "loyaltyClaimDone")
                      : t(lang, "loyaltyClaimAction")}
                </button>
                {err ? (
                  <span className="w-full text-[10px] font-bold text-danger">{claimErrorLabel(err)}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type AwardProps = {
  lang: Language;
  earnedPoints: number;
  balancePoints: number | null;
  confirmed: boolean;
};

/**
 * Post-sale award result (Phase 3).
 *
 * `confirmed` is true only once the server's own ledger row has been read back.
 * Until then this is explicitly an estimate — the cashier is never told points
 * are banked before the database has actually awarded them.
 */
export function PosLoyaltyAwardNote({ lang, earnedPoints, balancePoints, confirmed }: AwardProps) {
  if (earnedPoints <= 0) return null;
  return (
    <div
      className={
        confirmed
          ? "rounded-lg bg-success-muted px-3 py-2 text-sm font-black text-success"
          : "rounded-lg bg-warning-muted px-3 py-2 text-sm font-black text-warning-foreground"
      }
    >
      <span>
        {tTemplate(lang, "loyaltyEarnedPointsLabel", { points: earnedPoints.toLocaleString() })}
      </span>
      {confirmed && balancePoints != null ? (
        <span className="ml-2 font-bold">
          {t(lang, "loyaltyNewBalanceLabel")}: {balancePoints.toLocaleString()}{" "}
          {t(lang, "loyaltyPointsUnit")}
        </span>
      ) : (
        <span className="ml-2 text-xs font-bold opacity-80">
          ({t(lang, "loyaltyAwardEstimatedLabel")}) {t(lang, "loyaltyAwardPendingNote")}
        </span>
      )}
    </div>
  );
}
