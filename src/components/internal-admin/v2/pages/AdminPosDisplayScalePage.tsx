import { useCallback, useEffect, useState } from "react";
import { Loader2, MonitorSmartphone } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  adminUpdatePlatformDisplayScaleEnabled,
  fetchPlatformDisplayScaleSettings,
} from "../../../../lib/displayScale/platformDisplayScale";
import { DISPLAY_SCALE_LEVELS, DISPLAY_SCALE_META } from "../../../../lib/displayScale/scaleTokens";
import { isSuperAdmin, normalizeAdminRole } from "../adminRoles";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

export function AdminPosDisplayScalePage({ adminRow, previewMode = false }: Props) {
  const role = normalizeAdminRole(adminRow?.role);
  const canEdit = isSuperAdmin(role) || role === "operations_admin";
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { settings } = await fetchPlatformDisplayScaleSettings(true);
    setEnabled(settings.enabled);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (previewMode) {
      setLoading(false);
      return;
    }
    void load();
  }, [previewMode, load]);

  const onToggle = async (next: boolean) => {
    if (!canEdit || previewMode) return;
    setSaving(true);
    setMessage(null);
    const r = await adminUpdatePlatformDisplayScaleEnabled(next);
    setSaving(false);
    if (!r.ok) {
      setMessage(r.error ?? "Could not save");
      return;
    }
    setEnabled(next);
    setMessage("Saved — cashiers can use Display Scale on Sell when enabled.");
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-stone-900">POS Display Scale</h1>
        <p className="mt-1 text-sm text-stone-500">
          Enterprise density control for the Sell screen — not browser zoom. Each device keeps its own size in local
          storage.
        </p>
      </div>

      {previewMode ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950">
          Preview mode — platform toggle is read-only.
        </p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-stone-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : (
        <label className="flex min-h-[52px] items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm">
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-black text-stone-900">
              <MonitorSmartphone className="h-4 w-4 text-waka-600" aria-hidden />
              Enable Display Scale on Sell
            </span>
            <span className="mt-0.5 block text-xs font-medium text-stone-500">
              Shows the floating control on POS Sell for all shops when on.
            </span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-waka-600"
            checked={enabled}
            disabled={!canEdit || saving || previewMode}
            onChange={(e) => void onToggle(e.target.checked)}
          />
        </label>
      )}

      {message ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
          {message}
        </p>
      ) : null}

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black text-stone-900">Scale levels</h2>
        <p className="mt-1 text-xs text-stone-500">Cashiers pick one of four densities; preview below uses token multipliers.</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {DISPLAY_SCALE_LEVELS.map((level) => {
            const meta = DISPLAY_SCALE_META[level];
            return (
              <li
                key={level}
                className="rounded-xl border border-stone-100 bg-stone-50/80 px-3 py-2.5"
                style={{
                  fontSize: `calc(0.875rem * ${meta.multiplier})`,
                  padding: `calc(0.5rem * ${meta.multiplier})`,
                }}
              >
                <p className="font-black capitalize text-stone-900">{level.replace("_", " ")}</p>
                <p className="text-stone-600">{meta.percent}% · grid Δ {meta.columnDelta >= 0 ? "+" : ""}{meta.columnDelta} cols</p>
              </li>
            );
          })}
        </ul>
      </section>

      {!canEdit ? (
        <p className="text-xs font-semibold text-stone-500">Operations admin or super admin required to change the platform switch.</p>
      ) : null}
    </div>
  );
}
