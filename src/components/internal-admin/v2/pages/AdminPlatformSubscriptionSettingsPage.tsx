import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  adminUpdatePlatformSubscriptionSettings,
  DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS,
  fetchPlatformSubscriptionSettings,
  type PlatformSubscriptionSettings,
} from "../../../../lib/platformSubscriptionSettings";
import { ADMIN_PLAN_CODES, type AdminPlanCode } from "../../../../lib/subscriptionEngine";
import { isSuperAdmin, normalizeAdminRole } from "../adminRoles";
import { WakaSwitch } from "../../../enterprise/WakaSwitch";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

const inputCls =
  "mt-1 min-h-[44px] w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-waka-500";
const labelCls = "block text-[11px] font-black uppercase tracking-wide text-muted-foreground";

export function AdminPlatformSubscriptionSettingsPage({ adminRow, previewMode = false }: Props) {
  const role = normalizeAdminRole(adminRow?.role);
  const canEdit = isSuperAdmin(role) || role === "operations_admin" || previewMode;

  const [draft, setDraft] = useState<PlatformSubscriptionSettings>(DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS);
  const [loading, setLoading] = useState(!previewMode);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (previewMode) {
      setDraft({ ...DEFAULT_PLATFORM_SUBSCRIPTION_SETTINGS });
      setLoading(false);
      return;
    }
    setLoading(true);
    const { settings } = await fetchPlatformSubscriptionSettings(true);
    setDraft(settings);
    setLoading(false);
  }, [previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    setErr(null);
    setNotice(null);
    const result = await adminUpdatePlatformSubscriptionSettings(draft);
    setSaving(false);
    if (!result.ok) {
      setErr(result.message ?? "Save failed.");
      return;
    }
    setNotice(result.message ?? "Subscription settings saved.");
  };

  const reminderStr = draft.subscriptionReminderDays.join(", ");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-8">
      <header>
        <p className="text-[10px] font-black uppercase tracking-widest text-waka-800">Platform Settings</p>
        <h1 className="mt-1 text-xl font-black text-foreground">Subscription Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Billing platform configuration — no payment provider integration in this phase.
        </p>
      </header>

      {notice ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
          {notice}
        </p>
      ) : null}
      {err ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{err}</p>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <WakaSwitch
          checked={draft.automaticTrialEnabled}
          disabled={!canEdit}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, automaticTrialEnabled: v }))}
          label="Automatic Trial"
          description="Enable automatic trial on signup when platform trial switch is on."
        />

        <label className={labelCls}>
          Default Trial Plan
          <select
            value={draft.defaultTrialPlan}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, defaultTrialPlan: e.target.value as AdminPlanCode }))}
            className={inputCls}
          >
            {ADMIN_PLAN_CODES.map((code) => (
              <option key={code} value={code}>
                {code.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className={labelCls}>
          Default Trial Duration (days)
          <input
            type="number"
            min={1}
            max={365}
            value={draft.defaultTrialDurationDays}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, defaultTrialDurationDays: Number(e.target.value) || 14 }))}
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Monthly Duration (days)
          <input
            type="number"
            min={1}
            max={365}
            value={draft.monthlyDurationDays}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, monthlyDurationDays: Number(e.target.value) || 30 }))}
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Yearly Duration (days)
          <input
            type="number"
            min={30}
            max={3650}
            value={draft.yearlyDurationDays}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, yearlyDurationDays: Number(e.target.value) || 365 }))}
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Grace Period (days)
          <input
            type="number"
            min={0}
            max={90}
            value={draft.gracePeriodDays}
            disabled={!canEdit}
            onChange={(e) => setDraft((d) => ({ ...d, gracePeriodDays: Number(e.target.value) || 0 }))}
            className={inputCls}
          />
        </label>

        <label className={labelCls}>
          Subscription Reminder Days (comma-separated)
          <input
            type="text"
            value={reminderStr}
            disabled={!canEdit}
            onChange={(e) => {
              const nums = e.target.value
                .split(",")
                .map((s) => Math.floor(Number(s.trim())))
                .filter((n) => n > 0);
              setDraft((d) => ({ ...d, subscriptionReminderDays: nums.length ? nums : [7, 3, 1] }));
            }}
            className={inputCls}
          />
        </label>

        <WakaSwitch
          checked={draft.allowPromotionalGrants}
          disabled={!canEdit}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, allowPromotionalGrants: v }))}
          label="Allow Promotional Grants"
        />
        <WakaSwitch
          checked={draft.allowMultipleTrials}
          disabled={!canEdit}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, allowMultipleTrials: v }))}
          label="Allow Multiple Trials"
        />
        <WakaSwitch
          checked={draft.requireVerifiedEmailBeforeTrial}
          disabled={!canEdit}
          onCheckedChange={(v) => setDraft((d) => ({ ...d, requireVerifiedEmailBeforeTrial: v }))}
          label="Require Verified Email Before Trial"
        />
      </section>

      <button
        type="button"
        disabled={!canEdit || saving}
        onClick={() => void save()}
        className="min-h-[48px] w-full rounded-2xl bg-waka-600 text-sm font-black text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save subscription settings"}
      </button>
    </div>
  );
}
