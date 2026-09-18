import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import {
  createLoyaltyReward,
  fetchLoyaltyRewards,
  updateLoyaltyReward,
  validateRewardInput,
  type LoyaltyReward,
  type RewardInput,
} from "../../lib/loyalty/loyaltyRewards";
import { WakaSwitch } from "../enterprise/WakaSwitch";

const KIND_OPTIONS: LoyaltyReward["rewardKind"][] = ["custom", "product", "voucher"];

function kindLabelKey(kind: LoyaltyReward["rewardKind"]): string {
  if (kind === "product") return "loyaltyRewardKindProduct";
  if (kind === "voucher") return "loyaltyRewardKindVoucher";
  return "loyaltyRewardKindCustom";
}

const EMPTY_INPUT: RewardInput = {
  name: "",
  description: "",
  pointsRequired: 100,
  rewardKind: "custom",
  productId: null,
  maxRedemptionsPerAccount: null,
  active: true,
};

/** Merchant reward catalog management (Phase 08, managers only). */
export function LoyaltyRewardsPanel({
  lang,
  shopId,
  onChanged,
}: {
  lang: Language;
  shopId: string;
  onChanged: () => void;
}) {
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<RewardInput>({ ...EMPTY_INPUT });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "done" | "error">("idle");

  const reload = useCallback(async () => {
    const rows = await fetchLoyaltyRewards(shopId);
    setRewards(rows);
    setLoaded(true);
  }, [shopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const inputError = validateRewardInput(draft);

  const submitCreate = async () => {
    if (inputError) return;
    setSaveState("saving");
    const result = await createLoyaltyReward(shopId, draft);
    if (result.ok) {
      setSaveState("done");
      setDraft({ ...EMPTY_INPUT });
      await reload();
      onChanged();
    } else {
      setSaveState("error");
    }
  };

  const toggleActive = async (reward: LoyaltyReward) => {
    await updateLoyaltyReward(reward.id, { active: !reward.active });
    await reload();
    onChanged();
  };

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-base font-black text-foreground">{t(lang, "loyaltyRewardsTitle")}</p>
      <p className="mt-1 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyRewardsSub")}</p>

      {loaded && rewards.length === 0 ? (
        <p className="mt-3 text-sm font-medium text-muted-foreground">{t(lang, "loyaltyNoRewards")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {rewards.map((reward) => (
            <li key={reward.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-foreground">
                  {reward.name}
                  <span className={clsx("ml-2 rounded-full px-2 py-0.5 text-[10px] font-black", reward.active ? "bg-success-muted text-success" : "bg-muted text-muted-foreground")}>
                    {reward.active ? t(lang, "loyaltyRewardActive") : t(lang, "loyaltyRewardInactive")}
                  </span>
                </p>
                <p className="text-xs font-medium text-muted-foreground">
                  {reward.pointsRequired} {t(lang, "loyaltyPointsUnit")} · {t(lang, kindLabelKey(reward.rewardKind))}
                  {reward.maxRedemptionsPerAccount != null
                    ? ` · max ${reward.maxRedemptionsPerAccount}`
                    : ""}
                </p>
              </div>
              <WakaSwitch
                checked={reward.active}
                onCheckedChange={() => void toggleActive(reward)}
                label={undefined}
                aria-label={reward.name}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-2xl border border-border bg-muted/50 p-3">
        <p className="text-sm font-black text-foreground">{t(lang, "loyaltyAddReward")}</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "loyaltyRewardNameLabel")}
            <input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
            />
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "loyaltyRewardPointsLabel")}
            <input
              type="number"
              min={1}
              value={draft.pointsRequired}
              onChange={(e) => setDraft((d) => ({ ...d, pointsRequired: Number(e.target.value) }))}
              className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
            />
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "loyaltyRewardKindLabel")}
            <select
              value={draft.rewardKind}
              onChange={(e) =>
                setDraft((d) => ({ ...d, rewardKind: e.target.value as RewardInput["rewardKind"] }))
              }
              className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
            >
              {KIND_OPTIONS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(lang, kindLabelKey(kind))}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-bold text-foreground">
            {t(lang, "loyaltyRewardLimitLabel")}
            <input
              type="number"
              min={1}
              value={draft.maxRedemptionsPerAccount ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  maxRedemptionsPerAccount: e.target.value === "" ? null : Number(e.target.value),
                }))
              }
              className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm font-bold text-foreground">
          {t(lang, "loyaltyRewardDescriptionLabel")}
          <input
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            className="mt-1.5 min-h-[44px] w-full rounded-xl border-2 border-border bg-card px-3 py-2 text-base font-semibold"
          />
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void submitCreate()}
            disabled={saveState === "saving" || inputError != null}
            className="min-h-[44px] rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-50"
          >
            {t(lang, "loyaltyRewardCreate")}
          </button>
          {saveState === "done" ? (
            <span className="text-sm font-bold text-success">{t(lang, "loyaltyRewardCreated")}</span>
          ) : null}
          {saveState === "error" ? (
            <span className="text-sm font-bold text-destructive">{t(lang, "loyaltyRewardFailed")}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
