import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Trash2,
} from "lucide-react";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  EMPTY_RELEASE_DRAFT,
  PREVIEW_APP_RELEASES,
  archiveAppRelease,
  deleteAppRelease,
  duplicateAppRelease,
  fetchAppRelease,
  fetchAppReleaseEvents,
  fetchAppReleases,
  publishAppRelease,
  releaseToDraft,
  saveAppRelease,
  type AppReleaseDraft,
  type AppReleaseEvent,
  type AppReleaseSummary,
} from "../../../../lib/releaseManagementAdmin";
import { adminPermissions } from "../adminRoles";
import { WakaSwitch } from "../../../enterprise/WakaSwitch";
import { AdminRichTextEditor } from "../AdminRichTextEditor";

type Props = {
  adminRow: WakaInternalAdminRow | null;
  previewMode?: boolean;
};

const inputCls =
  "w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm font-semibold text-stone-900 outline-none focus:border-waka-500";
const labelCls = "mb-1 block text-[11px] font-black uppercase tracking-wide text-stone-500";

function statusBadge(status: string): string {
  if (status === "published") return "bg-emerald-100 text-emerald-800";
  if (status === "archived") return "bg-stone-200 text-stone-700";
  return "bg-amber-100 text-amber-900";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : value;
}

export function AdminReleaseManagementPage({ adminRow, previewMode = false }: Props) {
  const perms = adminPermissions(adminRow);
  const canEdit = perms.canManageAppReleases;

  const [loading, setLoading] = useState(true);
  const [releases, setReleases] = useState<AppReleaseSummary[]>([]);
  const [events, setEvents] = useState<AppReleaseEvent[]>([]);
  const [draft, setDraft] = useState<AppReleaseDraft>(EMPTY_RELEASE_DRAFT);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    if (previewMode) {
      setReleases(PREVIEW_APP_RELEASES);
      setEvents([]);
      setLoading(false);
      return;
    }
    const [rows, ev] = await Promise.all([fetchAppReleases(), fetchAppReleaseEvents(60)]);
    setReleases(rows);
    setEvents(ev);
    setLoading(false);
  }, [previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const published = useMemo(() => releases.find((r) => r.status === "published"), [releases]);

  const openNew = () => {
    setDraft(EMPTY_RELEASE_DRAFT);
    setEditing(true);
    setNotice(null);
    setError(null);
  };

  const openRelease = async (id: string) => {
    setNotice(null);
    setError(null);
    if (previewMode) {
      const row = PREVIEW_APP_RELEASES.find((r) => r.id === id);
      if (!row) return;
      setDraft({
        ...EMPTY_RELEASE_DRAFT,
        id: row.id,
        versionNumber: row.versionNumber,
        releaseName: row.releaseName,
        releaseDate: row.releaseDate ?? "",
        googlePlayVersionCode: String(row.googlePlayVersionCode),
        minimumSupportedVersion: row.minimumSupportedVersion,
        minimumSupportedVersionCode: String(row.minimumSupportedVersionCode),
        updateType: row.updateType,
        promptUsers: row.promptUsers,
        forceBelowMinimum: row.forceBelowMinimum,
        showWhatsNew: row.showWhatsNew,
        publicNotesHtml: "<ul><li>Faster checkout</li><li>Inventory improvements</li></ul>",
        internalNotesHtml: "<p>Preview only — internal notes never leave admin.</p>",
      });
      setEditing(true);
      return;
    }
    const detail = await fetchAppRelease(id);
    if (!detail) {
      setError("Could not load release.");
      return;
    }
    setDraft(releaseToDraft(detail));
    setEditing(true);
  };

  const handleSave = async () => {
    if (!canEdit || previewMode) return;
    setBusy(true);
    setError(null);
    const result = await saveAppRelease(draft);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Save failed");
      return;
    }
    if (result.release) setDraft(releaseToDraft(result.release));
    setNotice("Release saved.");
    void load();
  };

  const handlePublish = async () => {
    if (!draft.id || !canEdit || previewMode) return;
    if (!window.confirm("Publish this release? Current published release will be archived.")) return;
    setBusy(true);
    const result = await publishAppRelease(draft.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Publish failed");
      return;
    }
    setNotice("Release published.");
    void load();
    void openRelease(draft.id);
  };

  const handleArchive = async (id: string) => {
    if (!canEdit || previewMode) return;
    if (!window.confirm("Archive this release?")) return;
    setBusy(true);
    const result = await archiveAppRelease(id);
    setBusy(false);
    if (!result.ok) setError(result.error ?? "Archive failed");
    else {
      setNotice("Release archived.");
      void load();
    }
  };

  const handleDuplicate = async (id: string) => {
    if (!canEdit || previewMode) return;
    setBusy(true);
    const result = await duplicateAppRelease(id);
    setBusy(false);
    if (!result.ok || !result.release) {
      setError(result.error ?? "Duplicate failed");
      return;
    }
    setNotice("Draft duplicate created.");
    void load();
    void openRelease(result.release.id);
  };

  const handleDelete = async (id: string) => {
    if (!canEdit || previewMode) return;
    if (!window.confirm("Delete this draft permanently?")) return;
    setBusy(true);
    const result = await deleteAppRelease(id);
    setBusy(false);
    if (!result.ok) setError(result.error ?? "Delete failed");
    else {
      setNotice("Release deleted.");
      setEditing(false);
      void load();
    }
  };

  if (!canEdit && !previewMode) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-white p-6 text-center text-sm font-bold text-rose-800">
        Operations admin access required.
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-stone-950">Release Management</h1>
          <p className="mt-1 max-w-2xl text-sm font-medium text-stone-600">
            Control Google Play in-app update prompts and customer-facing release notes. APK distribution stays on Google Play.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-sm font-bold text-stone-800"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            disabled={previewMode}
            onClick={openNew}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-waka-600 px-4 text-sm font-black text-white disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            New release
          </button>
        </div>
      </header>

      {published ? (
        <article className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Live on devices</p>
          <p className="mt-1 text-lg font-black text-stone-950">
            v{published.versionNumber} · Play code {published.googlePlayVersionCode}
            {published.promptUsers ? " · Prompt ON" : " · Prompt OFF"}
          </p>
        </article>
      ) : null}

      {notice ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{notice}</p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">{error}</p>
      ) : null}

      {editing ? (
        <section className="grid gap-5 lg:grid-cols-2">
          <article className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-black text-stone-950">{draft.id ? "Edit release" : "New release"}</h2>
              <button type="button" onClick={() => setEditing(false)} className="text-sm font-bold text-stone-500">
                Close
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className={labelCls}>Version number</span>
                <input
                  className={inputCls}
                  value={draft.versionNumber}
                  onChange={(e) => setDraft((d) => ({ ...d, versionNumber: e.target.value }))}
                  placeholder="1.0.12"
                  disabled={previewMode}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Release name (optional)</span>
                <input
                  className={inputCls}
                  value={draft.releaseName}
                  onChange={(e) => setDraft((d) => ({ ...d, releaseName: e.target.value }))}
                  placeholder="June stability"
                  disabled={previewMode}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Release date</span>
                <input
                  type="date"
                  className={inputCls}
                  value={draft.releaseDate}
                  onChange={(e) => setDraft((d) => ({ ...d, releaseDate: e.target.value }))}
                  disabled={previewMode}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Google Play version code</span>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={draft.googlePlayVersionCode}
                  onChange={(e) => setDraft((d) => ({ ...d, googlePlayVersionCode: e.target.value.replace(/\D/g, "") }))}
                  disabled={previewMode}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Minimum supported version</span>
                <input
                  className={inputCls}
                  value={draft.minimumSupportedVersion}
                  onChange={(e) => setDraft((d) => ({ ...d, minimumSupportedVersion: e.target.value }))}
                  placeholder="1.0.10"
                  disabled={previewMode}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Minimum version code</span>
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={draft.minimumSupportedVersionCode}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, minimumSupportedVersionCode: e.target.value.replace(/\D/g, "") }))
                  }
                  disabled={previewMode}
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="rounded-xl border border-stone-200 p-4">
                <legend className="px-1 text-xs font-black uppercase tracking-wide text-stone-500">Update type</legend>
                <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="radio"
                    checked={draft.updateType === "flexible"}
                    onChange={() => setDraft((d) => ({ ...d, updateType: "flexible" }))}
                    disabled={previewMode}
                  />
                  Flexible update
                </label>
                <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="radio"
                    checked={draft.updateType === "immediate"}
                    onChange={() => setDraft((d) => ({ ...d, updateType: "immediate" }))}
                    disabled={previewMode}
                  />
                  Immediate update
                </label>
              </fieldset>

              <fieldset className="space-y-3 rounded-xl border border-stone-200 p-4">
                <legend className="px-1 text-xs font-black uppercase tracking-wide text-stone-500">Behavior</legend>
                {[
                  ["promptUsers", "Prompt users to update"],
                  ["forceBelowMinimum", "Force update below minimum version"],
                  ["showWhatsNew", "Show What's New after update"],
                ].map(([key, label]) => (
                  <WakaSwitch
                    key={key}
                    checked={draft[key as keyof AppReleaseDraft] as boolean}
                    disabled={previewMode}
                    onCheckedChange={(checked) => setDraft((d) => ({ ...d, [key]: checked }))}
                    label={label}
                    className="text-sm font-semibold"
                  />
                ))}
              </fieldset>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <AdminRichTextEditor
                label="Public release notes"
                hint="Customer-facing — sent to devices only when published."
                value={draft.publicNotesHtml}
                onChange={(html) => setDraft((d) => ({ ...d, publicNotesHtml: html }))}
                disabled={previewMode}
                variant="public"
              />
              <AdminRichTextEditor
                label="Internal release notes"
                hint="Admin only — never downloaded by the mobile app."
                value={draft.internalNotesHtml}
                onChange={(html) => setDraft((d) => ({ ...d, internalNotesHtml: html }))}
                disabled={previewMode}
                variant="internal"
                minHeightClass="min-h-[160px]"
              />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-4">
              <button
                type="button"
                disabled={busy || previewMode}
                onClick={() => void handleSave()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-stone-900 px-4 text-sm font-black text-white disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save draft
              </button>
              {draft.id ? (
                <>
                  <button
                    type="button"
                    disabled={busy || previewMode}
                    onClick={() => void handlePublish()}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50"
                  >
                    <Rocket className="h-4 w-4" />
                    Publish
                  </button>
                  <button
                    type="button"
                    disabled={busy || previewMode}
                    onClick={() => void handleArchive(draft.id!)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 text-sm font-bold"
                  >
                    <Archive className="h-4 w-4" />
                    Archive
                  </button>
                  <button
                    type="button"
                    disabled={busy || previewMode}
                    onClick={() => void handleDelete(draft.id!)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-bold text-rose-800"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </>
              ) : null}
            </div>
          </article>
        </section>
      ) : null}

      <section className="rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-black uppercase tracking-wide text-stone-600">Release history</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm font-semibold text-stone-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-stone-50 text-[11px] font-black uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-3">Version</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Prompt</th>
                  <th className="px-4 py-3">Min version</th>
                  <th className="px-4 py-3">Published by</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {releases.map((row) => (
                  <tr key={row.id} className="border-t border-stone-100 hover:bg-stone-50/80">
                    <td className="px-4 py-3 font-bold text-stone-900">
                      {row.versionNumber}
                      <span className="ml-1 text-xs font-semibold text-stone-500">({row.googlePlayVersionCode})</span>
                    </td>
                    <td className="px-4 py-3">{formatDate(row.releaseDate)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-black uppercase ${statusBadge(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 capitalize">{row.updateType}</td>
                    <td className="px-4 py-3">{row.promptUsers ? "ON" : "OFF"}</td>
                    <td className="px-4 py-3">
                      {row.minimumSupportedVersion || "—"}
                      {row.minimumSupportedVersionCode ? ` (${row.minimumSupportedVersionCode})` : ""}
                    </td>
                    <td className="px-4 py-3">{row.publishedByName || "—"}</td>
                    <td className="px-4 py-3 text-xs text-stone-500">{formatDate(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => void openRelease(row.id)}
                          className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold"
                        >
                          {draft.id === row.id && editing ? "Editing" : "View"}
                        </button>
                        <button
                          type="button"
                          disabled={previewMode}
                          onClick={() => void handleDuplicate(row.id)}
                          className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold disabled:opacity-50"
                        >
                          <Copy className="inline h-3 w-3" /> Dup
                        </button>
                        {row.status !== "archived" ? (
                          <button
                            type="button"
                            disabled={previewMode}
                            onClick={() => void handleArchive(row.id)}
                            className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-bold disabled:opacity-50"
                          >
                            Archive
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {releases.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm font-semibold text-stone-500">
                      No releases yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!previewMode && events.length > 0 ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-wide text-stone-600">Recent client events</h2>
          <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto text-xs">
            {events.slice(0, 20).map((ev) => (
              <li key={ev.id} className="flex flex-wrap gap-2 rounded-lg bg-stone-50 px-3 py-2 font-medium text-stone-700">
                <span className="font-black text-waka-700">{ev.eventType}</span>
                <span>{new Date(ev.createdAt).toLocaleString()}</span>
                {ev.appVersion ? <span>v{ev.appVersion}</span> : null}
                {ev.deviceId ? <span className="truncate text-stone-500">{ev.deviceId}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
