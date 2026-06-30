import { useState } from "react";
import { Search } from "lucide-react";
import { searchDevices, type DeviceSearchHit } from "../../../lib/internalOpsHardening";
import { internalAdminShopHref } from "../../../lib/internalAdminPreview";
import { Link } from "react-router-dom";

type Props = { previewMode?: boolean };

export function AdminDeviceForensicsPanel({ previewMode = false }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<DeviceSearchHit[]>([]);
  const [busy, setBusy] = useState(false);

  const runSearch = () => {
    const q = query.trim();
    if (q.length < 2) return;
    setBusy(true);
    void searchDevices(q).then((rows) => {
      setHits(rows);
      setBusy(false);
    });
  };

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-black text-stone-900">Device forensics</h2>
      <p className="mt-0.5 text-xs text-stone-500">Search device UUID, fingerprint, or installation ID.</p>

      <div className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder="Device ID or fingerprint…"
          className="min-h-[44px] flex-1 rounded-xl border border-stone-200 px-3 font-mono text-xs"
        />
        <button
          type="button"
          disabled={busy}
          onClick={runSearch}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-waka-600 px-4 text-xs font-black text-white disabled:opacity-50"
        >
          <Search className="h-4 w-4" aria-hidden />
          Search
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {hits.length === 0 && query.trim().length >= 2 && !busy ? (
          <li className="text-sm font-semibold text-stone-500">No devices found.</li>
        ) : null}
        {hits.map((d) => (
          <li key={d.device_id} className="rounded-xl border border-stone-100 bg-stone-50 p-3 text-sm">
            <p className="font-black text-stone-900">{d.shop_name}</p>
            <p className="font-mono text-[10px] text-stone-500">{d.device_id}</p>
            <p className="mt-1 text-xs text-stone-600">
              {d.platform ?? "—"} · v{d.app_version ?? "—"} · {d.owner_email ?? "—"}
            </p>
            <p className="mt-1 font-mono text-[10px] text-stone-500">FP {d.device_fingerprint.slice(0, 24)}…</p>
            <p className="mt-1 text-xs">
              Last seen: {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString("en-GB") : "—"}
            </p>
            {d.last_error ? <p className="mt-1 text-xs font-semibold text-rose-800">Error: {d.last_error}</p> : null}
            <p className="text-xs text-stone-600">Pending: {d.pending_outbound ?? 0}</p>
            <Link
              to={internalAdminShopHref(d.shop_id, previewMode)}
              className="mt-2 inline-block text-xs font-black text-waka-700 underline"
            >
              Open shop →
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
