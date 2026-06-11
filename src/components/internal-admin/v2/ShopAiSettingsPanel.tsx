import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  adminFetchShopAiSettings,
  adminUpdateShopAiSettings,
  type AdminShopAiBundle,
} from "../../../lib/ai/shopAiAdmin";
import type { ShopAiSettings } from "../../../lib/ai/shopAiSettings";
import { DEFAULT_SHOP_AI_SETTINGS } from "../../../lib/ai/shopAiSettings";

type Props = {
  shopId: string;
  canManage: boolean;
  previewMode?: boolean;
};

const FEATURE_FIELDS: Array<{ key: keyof ShopAiSettings; label: string }> = [
  { key: "product_assistant", label: "Product Assistant" },
  { key: "business_setup_assistant", label: "Business Setup Assistant" },
  { key: "inventory_assistant", label: "Inventory Assistant" },
  { key: "marketing_assistant", label: "Marketing Assistant" },
  { key: "marketplace_assistant", label: "Marketplace Assistant" },
];

function formatActivity(at: string | null): string {
  if (!at) return "Never";
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return "Never";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ShopAiSettingsPanel({ shopId, canManage, previewMode = false }: Props) {
  const [bundle, setBundle] = useState<AdminShopAiBundle | null>(null);
  const [draft, setDraft] = useState<ShopAiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (previewMode) {
      setBundle({
        settings: {
          shop_id: shopId,
          ...DEFAULT_SHOP_AI_SETTINGS,
          ai_enabled: true,
          product_assistant: true,
          inventory_assistant: true,
        },
        usage: { requests_this_month: 142, last_activity_at: new Date().toISOString() },
      });
      setDraft({
        shop_id: shopId,
        ...DEFAULT_SHOP_AI_SETTINGS,
        ai_enabled: true,
        product_assistant: true,
        inventory_assistant: true,
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    const data = await adminFetchShopAiSettings(shopId);
    setBundle(data);
    setDraft(data?.settings ?? null);
    setLoading(false);
  }, [shopId, previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft || saving || previewMode || !canManage) return;
    setSaving(true);
    setMessage(null);
    const res = await adminUpdateShopAiSettings(shopId, {
      ai_enabled: draft.ai_enabled,
      product_assistant: draft.product_assistant,
      business_setup_assistant: draft.business_setup_assistant,
      inventory_assistant: draft.inventory_assistant,
      marketing_assistant: draft.marketing_assistant,
      marketplace_assistant: draft.marketplace_assistant,
      monthly_request_limit: draft.monthly_request_limit,
    });
    setSaving(false);
    if (!res.ok) {
      setMessage(res.error ?? "Save failed");
      return;
    }
    setMessage("Shop AI settings saved.");
    await load();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm font-semibold text-stone-600">
        <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
        Loading AI settings…
      </div>
    );
  }

  if (!draft || !bundle) {
    return <p className="text-sm font-semibold text-stone-600">Could not load shop AI settings.</p>;
  }

  const masterOff = !draft.ai_enabled;
  const usage = bundle.usage;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">Current usage</p>
          <p className="mt-1 text-lg font-black text-stone-900">
            {usage.requests_this_month} / {draft.monthly_request_limit}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">Last AI activity</p>
          <p className="mt-1 text-sm font-bold text-stone-900">{formatActivity(usage.last_activity_at)}</p>
        </div>
      </div>

      <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
        <span className="text-sm font-bold text-stone-800">AI access</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-orange-600"
          checked={draft.ai_enabled}
          disabled={!canManage || previewMode}
          onChange={(e) => setDraft({ ...draft, ai_enabled: e.target.checked })}
        />
      </label>

      <div className="space-y-2">
        {FEATURE_FIELDS.map(({ key, label }) => (
          <label
            key={key}
            className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3"
          >
            <span className="text-sm font-bold text-stone-800">{label}</span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-orange-600"
              checked={draft[key] === true}
              disabled={!canManage || previewMode || masterOff}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
            />
          </label>
        ))}
      </div>

      <label className="block text-[11px] font-black uppercase tracking-wide text-stone-500">
        Monthly request limit
        <input
          type="number"
          min={0}
          className="mt-1 min-h-[44px] w-full rounded-xl border border-stone-300 bg-white px-3 text-sm font-semibold"
          value={draft.monthly_request_limit}
          disabled={!canManage || previewMode}
          onChange={(e) =>
            setDraft({
              ...draft,
              monthly_request_limit: Math.max(0, Math.floor(Number(e.target.value) || 0)),
            })
          }
        />
      </label>

      {message ? (
        <p className="rounded-xl bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800">{message}</p>
      ) : null}

      {canManage ? (
        <button
          type="button"
          disabled={saving || previewMode}
          onClick={() => void save()}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-black text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save shop AI settings
        </button>
      ) : (
        <p className="text-xs font-semibold text-stone-500">Super admin or operations admin required to edit.</p>
      )}
    </div>
  );
}
