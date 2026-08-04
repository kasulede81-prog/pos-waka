import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { adminFetchShopVisionSettings, adminUpdateShopVisionSettings } from "../../../lib/vision/shopVisionAdmin";
import {
  DEFAULT_SHOP_VISION_SETTINGS,
  VISION_CAPACITY_BY_WAKA_PLAN,
  type ShopVisionSettings,
} from "../../../lib/vision/shopVisionSettings";
import { resolveVisionAccess } from "../../../lib/vision/canUseVision";
import type { SubscriptionSnapshot } from "../../../lib/subscriptionEntitlements";
import { fetchSubscriptionSnapshotForShop } from "../../../lib/subscriptionEngine";
import { WakaSwitch } from "../../enterprise/WakaSwitch";

type Props = {
  shopId: string;
  canManage: boolean;
  previewMode?: boolean;
};

function previewSnapshot(): SubscriptionSnapshot {
  return {
    kind: "remote",
    row: {
      id: "preview",
      organization_id: "preview",
      shop_id: null,
      status: "active",
      trial_ends_at: null,
      current_period_start: "2026-01-01T00:00:00.000Z",
      current_period_end: "2027-01-01T00:00:00.000Z",
      plan_code: "business",
      max_pos_users: null,
      max_shops: null,
      max_devices: null,
    },
  };
}

export function ShopVisionSettingsPanel({ shopId, canManage, previewMode = false }: Props) {
  const [draft, setDraft] = useState<ShopVisionSettings | null>(null);
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot>(previewSnapshot());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (previewMode) {
      setDraft({
        shop_id: shopId,
        ...DEFAULT_SHOP_VISION_SETTINGS,
      });
      setSnapshot(previewSnapshot());
      setLoading(false);
      return;
    }
    setLoading(true);
    const [data, snap] = await Promise.all([
      adminFetchShopVisionSettings(shopId),
      fetchSubscriptionSnapshotForShop(shopId),
    ]);
    setDraft(
      data ?? {
        shop_id: shopId,
        ...DEFAULT_SHOP_VISION_SETTINGS,
      },
    );
    setSnapshot(snap);
    setLoading(false);
  }, [shopId, previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft || saving || previewMode || !canManage) return;
    setSaving(true);
    setMessage(null);
    const res = await adminUpdateShopVisionSettings(shopId, {
      admin_disabled: draft.admin_disabled,
      max_dvrs: draft.max_dvrs,
      max_cameras: draft.max_cameras,
      feature_remote_access: draft.feature_remote_access,
      feature_ai_analytics: draft.feature_ai_analytics,
      installer_label: draft.installer_label,
      // Keep core feature flags on; capacity is the product differentiator.
      feature_live_view: true,
      feature_monitoring: true,
      feature_pos_timeline: true,
      vision_enabled: !draft.admin_disabled,
      trial_enabled: false,
      license_tier: "none",
    });
    setSaving(false);
    if (!res.ok) {
      setMessage(res.error ?? "Save failed");
      return;
    }
    setMessage("Vision settings saved.");
    await load();
  };

  if (loading || !draft) {
    return (
      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Vision settings…
      </div>
    );
  }

  const access = resolveVisionAccess({
    settings: draft,
    shopId,
    authMode: "cloud",
    snapshot,
  });
  const editable = canManage && !previewMode;
  const planDefaults = VISION_CAPACITY_BY_WAKA_PLAN[access.planCode] ?? VISION_CAPACITY_BY_WAKA_PLAN.free;

  return (
    <div className="space-y-4 p-1">
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
        <div className="font-semibold">
          Vision · Included with WAKA {access.planLabel}
          {access.onWakaTrial ? " (trial)" : ""}
        </div>
        <div className="text-muted-foreground">
          Status: {access.status.replaceAll("_", " ")} ·{" "}
          {access.maxCameras == null ? "Unlimited cameras" : `${access.maxCameras} cameras`} ·{" "}
          {access.maxDvrs == null ? "Unlimited DVRs" : `${access.maxDvrs} DVRs`}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Plan defaults ({access.planLabel}):{" "}
          {planDefaults.max_cameras == null ? "Unlimited" : planDefaults.max_cameras} cameras /{" "}
          {planDefaults.max_dvrs == null ? "Unlimited" : planDefaults.max_dvrs} DVRs. Empty override
          fields use these defaults.
        </div>
        {draft.installer_label ? (
          <div className="text-muted-foreground">Installer: {draft.installer_label}</div>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        Vision is not a separate product. Activation follows the shop&apos;s WAKA subscription. Manage
        capacity overrides and support controls below.
      </p>

      <WakaSwitch
        checked={draft.admin_disabled}
        onCheckedChange={(v) => setDraft({ ...draft, admin_disabled: v })}
        disabled={!editable}
        label="Disable Vision for this shop (support override)"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-muted-foreground">Maximum DVRs (override)</span>
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
            disabled={!editable}
            value={draft.max_dvrs ?? ""}
            placeholder="Plan default"
            onChange={(e) =>
              setDraft({
                ...draft,
                max_dvrs: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0),
              })
            }
          />
        </label>
        <label className="text-sm">
          <span className="text-muted-foreground">Maximum Cameras (override)</span>
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
            disabled={!editable}
            value={draft.max_cameras ?? ""}
            placeholder="Plan default"
            onChange={(e) =>
              setDraft({
                ...draft,
                max_cameras: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0),
              })
            }
          />
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Future premium add-ons (not core Vision)</legend>
        <WakaSwitch
          checked={draft.feature_remote_access}
          onCheckedChange={(v) => setDraft({ ...draft, feature_remote_access: v })}
          disabled={!editable}
          label="Remote Monitoring (future)"
        />
        <WakaSwitch
          checked={draft.feature_ai_analytics}
          onCheckedChange={(v) => setDraft({ ...draft, feature_ai_analytics: v })}
          disabled={!editable}
          label="AI Analytics (future)"
        />
      </fieldset>

      <label className="block text-sm">
        <span className="text-muted-foreground">Assign installer</span>
        <input
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
          disabled={!editable}
          value={draft.installer_label ?? ""}
          placeholder="Installer name or company"
          onChange={(e) => setDraft({ ...draft, installer_label: e.target.value || null })}
        />
      </label>

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

      <button
        type="button"
        disabled={!editable || saving}
        onClick={() => void save()}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Save Vision settings
      </button>
    </div>
  );
}
