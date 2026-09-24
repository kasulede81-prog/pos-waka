import { useCallback, useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { fetchLoyaltyRewards, type LoyaltyReward } from "../../lib/loyalty/loyaltyRewards";
import {
  assignLoyaltyReward,
  listRewardAssignments,
  revokeLoyaltyRewardAssignment,
  type LoyaltyRewardAssignment,
} from "../../lib/loyalty/loyaltyRewardAssignments";

/**
 * Decision 029 — assign shop rewards to a specific loyalty customer.
 */
export function LoyaltyCustomerRewardsPanel({
  lang,
  shopId,
  accountId,
  canManage,
}: {
  lang: Language;
  shopId: string;
  accountId: string;
  canManage: boolean;
}) {
  const [assignments, setAssignments] = useState<LoyaltyRewardAssignment[]>([]);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [rewardId, setRewardId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);

  const reload = useCallback(async () => {
    const [rows, catalog] = await Promise.all([
      listRewardAssignments(shopId, accountId),
      fetchLoyaltyRewards(shopId),
    ]);
    setAssignments(rows);
    const active = catalog.filter((r) => r.active);
    setRewards(active);
    if (!rewardId && active[0]?.id) setRewardId(active[0].id);
  }, [shopId, accountId, rewardId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onAssign = async () => {
    if (!canManage || !rewardId) return;
    setBusy(true);
    setError(null);
    const result = await assignLoyaltyReward(shopId, accountId, rewardId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShowAssign(false);
    await reload();
  };

  const onRevoke = async (assignmentId: string) => {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    const result = await revokeLoyaltyRewardAssignment(shopId, assignmentId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await reload();
  };

  const active = assignments.filter((a) => a.status === "active");

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-black text-foreground">{t(lang, "loyaltyCustomerRewardsTitle")}</p>
        {canManage ? (
          <button
            type="button"
            onClick={() => setShowAssign((v) => !v)}
            className="min-h-[36px] rounded-xl border-2 border-waka-600 bg-card px-3 text-xs font-black text-waka-700"
          >
            {t(lang, "loyaltyCustomerRewardsAssign")}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs font-medium text-muted-foreground">
        {t(lang, "loyaltyCustomerRewardsSub")}
      </p>

      {showAssign && canManage ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-xs font-bold text-foreground">
            {t(lang, "loyaltyCustomerRewardsPick")}
            <select
              value={rewardId}
              onChange={(e) => setRewardId(e.target.value)}
              className="mt-1 min-h-[40px] w-full rounded-xl border-2 border-border bg-card px-3 text-sm font-semibold"
            >
              {rewards.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.pointsRequired} pts
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !rewardId}
            onClick={() => void onAssign()}
            className="min-h-[40px] rounded-xl bg-waka-600 px-4 text-xs font-black text-white disabled:opacity-50"
          >
            {busy ? t(lang, "loyaltyLoading") : t(lang, "loyaltyCustomerRewardsConfirm")}
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs font-bold text-destructive">{error}</p> : null}

      {active.length === 0 ? (
        <p className="mt-3 text-xs font-medium text-muted-foreground">
          {t(lang, "loyaltyCustomerRewardsEmpty")}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {active.map((a) => {
            const usable = a.assignmentUsable && a.rewardActive && a.rewardUnexpired;
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">{a.rewardName}</p>
                  <p className="text-xs font-medium text-muted-foreground">
                    {a.pointsRequired} pts
                    {" · "}
                    {usable
                      ? t(lang, "loyaltyCustomerRewardsStatusActive")
                      : t(lang, "loyaltyCustomerRewardsStatusUnavailable")}
                    {a.expiresAt
                      ? ` · ${t(lang, "loyaltyCustomerRewardsExpires")}: ${a.expiresAt.slice(0, 10)}`
                      : ""}
                    {a.rewardExpiresOn
                      ? ` · ${t(lang, "loyaltyRewardExpiresOn")}: ${a.rewardExpiresOn}`
                      : ""}
                  </p>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onRevoke(a.id)}
                    className="min-h-[36px] shrink-0 rounded-xl border-2 border-border px-3 text-xs font-black text-foreground disabled:opacity-50"
                  >
                    {t(lang, "loyaltyCustomerRewardsRemove")}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
