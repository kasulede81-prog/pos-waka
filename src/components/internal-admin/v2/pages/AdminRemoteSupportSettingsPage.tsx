import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  adminUpdateRemoteSupportPlatformEnabled,
  fetchRemoteSupportPlatformSettings,
} from "../../../../lib/remoteSupport";
import { canRemoteSupport, normalizeAdminRole } from "../adminRoles";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

export function AdminRemoteSupportSettingsPage({ adminRow, previewMode = false }: Props) {
  const role = normalizeAdminRole(adminRow?.role);
  const canEdit = canRemoteSupport(role);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const settings = await fetchRemoteSupportPlatformSettings();
    setEnabled(settings.enabled === true);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (previewMode) {
      setEnabled(false);
      setLoading(false);
      return;
    }
    void load();
  }, [previewMode, load]);

  const setSwitch = async (next: boolean) => {
    if (!canEdit || previewMode) return;
    setSaving(true);
    setMessage(null);
    const r = await adminUpdateRemoteSupportPlatformEnabled(next);
    setSaving(false);
    if (!r.ok) {
      setMessage(r.error ?? "Could not save");
      return;
    }
    setEnabled(next);
    setMessage(next ? "Remote Support is ENABLED." : "Remote Support is DISABLED.");
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-foreground">Remote Support</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Master switch for technician remote assistance. Default is off. The POS Help button is hidden while this is off.
        </p>
      </div>

      {previewMode ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950">
          Preview mode — master switch is read-only.
        </p>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Status</p>
          <p className={`mt-1 text-lg font-black ${enabled ? "text-emerald-700" : "text-rose-800"}`}>
            {enabled ? "ENABLED" : "DISABLED"}
          </p>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            {enabled
              ? "Connect Remotely and Electron lab transport follow the existing authorization flow."
              : "Customers cannot start remote sessions. The Help button is hidden. Connect Remotely is hidden. Native transport is rejected."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canEdit || saving || previewMode || enabled}
              onClick={() => void setSwitch(true)}
              className="min-h-[40px] rounded-xl bg-waka-600 px-4 text-xs font-black text-white disabled:bg-muted disabled:text-muted-foreground"
            >
              Enable Remote Support
            </button>
            <button
              type="button"
              disabled={!canEdit || saving || previewMode || !enabled}
              onClick={() => void setSwitch(false)}
              className="min-h-[40px] rounded-xl border border-border px-4 text-xs font-black disabled:opacity-40"
            >
              Disable Remote Support
            </button>
          </div>
          {!canEdit ? (
            <p className="mt-3 text-xs font-semibold text-muted-foreground">
              Only super admin and support admin can change this switch.
            </p>
          ) : null}
          {message ? <p className="mt-3 text-xs font-bold text-foreground">{message}</p> : null}
        </section>
      )}
    </div>
  );
}
