import { useCallback, useEffect, useState } from "react";
import { Loader2, MonitorSmartphone } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  adminUpdatePlatformDisplayScaleEnabled,
  fetchPlatformDisplayScaleSettings,
} from "../../../../lib/displayScale/platformDisplayScale";
import { DISPLAY_SCALE_LEVELS, DISPLAY_SCALE_META } from "../../../../lib/displayScale/scaleTokens";
import { isSuperAdmin, normalizeAdminRole } from "../adminRoles";
import { WakaSwitch } from "../../../enterprise/WakaSwitch";

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
        <h1 className="text-xl font-black text-foreground">POS Display Scale</h1>
        <p className="mt-1 text-sm text-muted-foreground">
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
        <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : (
        <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <WakaSwitch
            checked={enabled}
            disabled={!canEdit || saving || previewMode}
            onCheckedChange={(checked) => void onToggle(checked)}
            label={
              <span className="flex items-center gap-2 text-sm font-black text-foreground">
                <MonitorSmartphone className="h-4 w-4 text-waka-600" aria-hidden />
                Enable Display Scale on Sell
              </span>
            }
            description="Shows the floating control on POS Sell for all shops when on."
          />
        </div>
      )}

      {message ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
          {message}
        </p>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-black text-foreground">Scale levels</h2>
        <p className="mt-1 text-xs text-muted-foreground">Cashiers pick one of four densities; preview below uses token multipliers.</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {DISPLAY_SCALE_LEVELS.map((level) => {
            const meta = DISPLAY_SCALE_META[level];
            return (
              <li
                key={level}
                className="rounded-xl border border-border bg-muted/80 px-3 py-2.5"
                style={{
                  fontSize: `calc(0.875rem * ${meta.multiplier})`,
                  padding: `calc(0.5rem * ${meta.multiplier})`,
                }}
              >
                <p className="font-black capitalize text-foreground">{level.replace("_", " ")}</p>
                <p className="text-muted-foreground">{meta.percent}% · grid Δ {meta.columnDelta >= 0 ? "+" : ""}{meta.columnDelta} cols</p>
              </li>
            );
          })}
        </ul>
      </section>

      {!canEdit ? (
        <p className="text-xs font-semibold text-muted-foreground">Operations admin or super admin required to change the platform switch.</p>
      ) : null}
    </div>
  );
}
