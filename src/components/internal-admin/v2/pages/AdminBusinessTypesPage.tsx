import { useCallback, useEffect, useMemo, useState } from "react";
import type { BusinessType } from "../../../../types";
import { BUSINESS_TYPE_IDS } from "../../../../config/businessTypes";
import {
  EXPERIMENTAL_BUSINESS_TYPE_IDS,
  EXPERIMENTAL_DISPLAY_ALIASES,
  getVisibleBusinessTypes,
  isExperimentalBusinessType,
  type PlatformBusinessTypeSettings,
} from "../../../../config/businessTypeVisibility";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  adminSetBusinessTypeEnabled,
  adminSetShowExperimentalBusinessTypes,
  fetchPlatformBusinessTypeSettings,
} from "../../../../lib/platformBusinessTypes";
import { isSuperAdmin, normalizeAdminRole } from "../adminRoles";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode: boolean;
};

function displayName(id: BusinessType): string {
  return EXPERIMENTAL_DISPLAY_ALIASES[id] ?? id.replace(/_/g, " ");
}

function TypeRow({
  id,
  enabled,
  experimental,
  statusLabel,
  busy,
  onToggle,
}: {
  id: BusinessType;
  enabled: boolean;
  experimental: boolean;
  statusLabel: string;
  busy: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-black text-stone-900">{displayName(id)}</p>
        <p className="font-mono text-xs text-stone-500">{id}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
              enabled ? "bg-emerald-100 text-emerald-900" : "bg-stone-200 text-stone-700"
            }`}
          >
            {statusLabel}
          </span>
          {experimental ? (
            <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-violet-900">
              Experimental
            </span>
          ) : null}
        </div>
      </div>
      <label className="flex shrink-0 cursor-pointer items-center gap-2">
        <span className="text-xs font-bold text-stone-600">{enabled ? "On" : "Off"}</span>
        <input
          type="checkbox"
          className="h-5 w-5 rounded border-stone-300"
          checked={enabled}
          disabled={busy}
          onChange={(e) => onToggle(e.target.checked)}
        />
      </label>
    </div>
  );
}

export function AdminBusinessTypesPage({ adminRow, previewMode }: Props) {
  const role = normalizeAdminRole(adminRow?.role);
  const superOk = isSuperAdmin(role) || previewMode;
  const [settings, setSettings] = useState<PlatformBusinessTypeSettings | null>(null);
  const [loading, setLoading] = useState(!previewMode);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (previewMode) {
      setSettings({
        enabled: [...BUSINESS_TYPE_IDS],
        showExperimental: true,
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    const { settings: s } = await fetchPlatformBusinessTypeSettings(true);
    setSettings(s);
    setLoading(false);
  }, [previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const standardIds = useMemo(() => {
    return BUSINESS_TYPE_IDS.filter((id) => !isExperimentalBusinessType(id));
  }, []);

  const experimentalIds = useMemo(() => [...EXPERIMENTAL_BUSINESS_TYPE_IDS, "other" as BusinessType], []);

  const toggleType = async (id: BusinessType, next: boolean) => {
    if (previewMode) {
      setSettings((prev) => {
        if (!prev) return prev;
        const enabled = next
          ? [...new Set([...prev.enabled, id])]
          : prev.enabled.filter((x) => x !== id);
        return { ...prev, enabled };
      });
      return;
    }
    setBusyId(id);
    setErr(null);
    const result = await adminSetBusinessTypeEnabled(id, next);
    setBusyId(null);
    if (!result.ok) {
      setErr(result.error ?? "Update failed");
      return;
    }
    await load();
  };

  const toggleExperimentalSection = async (next: boolean) => {
    if (previewMode) {
      setSettings((prev) => (prev ? { ...prev, showExperimental: next } : prev));
      return;
    }
    setErr(null);
    const result = await adminSetShowExperimentalBusinessTypes(next);
    if (!result.ok) {
      setErr(result.error ?? "Update failed");
      return;
    }
    await load();
  };

  if (!superOk) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-white p-6 text-center text-sm font-bold text-rose-800">
        Super admin only — Business Types settings.
      </div>
    );
  }

  const visiblePreview = settings ? getVisibleBusinessTypes(settings, true) : [];

  return (
    <div className="space-y-5 pb-16">
      <div>
        <h1 className="text-2xl font-black text-stone-900">Business Types</h1>
        <p className="mt-1 text-sm text-stone-600">
          Controls which types appear in registration and onboarding. Existing shops are not changed.
        </p>
      </div>

      {err ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">{err}</p>
      ) : null}

      {loading || !settings ? (
        <p className="text-sm text-stone-500">Loading business type settings…</p>
      ) : (
        <>
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
            <div>
              <p className="text-sm font-black text-violet-950">Highlight experimental in admin preview</p>
              <p className="text-xs text-violet-800">
                Cosmetic only for this page. Registration uses the On/Off toggles below — including hardware and
                electronics.
              </p>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={settings.showExperimental}
              onChange={(e) => void toggleExperimentalSection(e.target.checked)}
            />
          </label>

          <section className="space-y-2">
            <h2 className="text-sm font-black uppercase tracking-wide text-stone-500">Standard business types</h2>
            {standardIds.map((id) => {
              const enabled = settings.enabled.includes(id);
              const row = visiblePreview.find((v) => v.id === id);
              return (
                <TypeRow
                  key={id}
                  id={id}
                  enabled={enabled}
                  experimental={false}
                  statusLabel={row?.status ?? (enabled ? "enabled" : "disabled")}
                  busy={busyId === id}
                  onToggle={(next) => void toggleType(id, next)}
                />
              );
            })}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-black uppercase tracking-wide text-violet-700">
              Optional / experimental (registration)
            </h2>
            <p className="text-xs text-stone-600">
              Turn <strong>Off</strong> to hide from signup and onboarding (e.g. hardware, electronics). These toggles
              always apply — not hidden when the highlight option above is off.
            </p>
            {experimentalIds.map((id) => {
              const enabled = settings.enabled.includes(id);
              const row = visiblePreview.find((v) => v.id === id);
              return (
                <TypeRow
                  key={id}
                  id={id}
                  enabled={enabled}
                  experimental
                  statusLabel={row?.status ?? (enabled ? "enabled" : "disabled")}
                  busy={busyId === id}
                  onToggle={(next) => void toggleType(id, next)}
                />
              );
            })}
          </section>

          <p className="text-xs text-stone-500">
            Audit: <code className="font-mono">business_type_enabled</code> /{" "}
            <code className="font-mono">business_type_disabled</code> in internal ops audit log.
          </p>
        </>
      )}
    </div>
  );
}
