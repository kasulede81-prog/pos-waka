import type { ShopOpsDetail } from "../../../lib/wakaInternalAdmin";
import { PILOT_QUEUE_THRESHOLD } from "../../../lib/internalOpsHardening";

type Props = {
  detail: ShopOpsDetail;
  diagnosticsPending?: number | null;
};

export function AdminSyncInvestigationPanel({ detail, diagnosticsPending }: Props) {
  const sy = detail.sync_health;
  const pending = sy?.pending_outbound ?? diagnosticsPending ?? 0;
  const hasError = Boolean(sy?.last_error?.trim());
  const queueHot = pending > PILOT_QUEUE_THRESHOLD;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-black text-stone-900">Sync investigation</h2>
      <p className="mt-0.5 text-xs text-stone-500">Cloud queue state — no database access required.</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {hasError ? (
          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-black text-rose-900">Sync failure</span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-900">No last error</span>
        )}
        {queueHot ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-black text-amber-900">
            Queue &gt; {PILOT_QUEUE_THRESHOLD}
          </span>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-2 text-sm">
        <Row label="Pending outbound" value={String(pending)} highlight={queueHot} />
        <Row label="Failed outbound (sales)" value="See owner diagnostics import" />
        <Row
          label="Queue breakdown"
          value={
            diagnosticsPending != null
              ? `Imported snapshot: ${diagnosticsPending} total`
              : "Import diagnostics JSON for device-side breakdown"
          }
        />
        <Row
          label="Last push OK"
          value={sy?.last_push_ok_at ? new Date(sy.last_push_ok_at).toLocaleString("en-GB") : "—"}
        />
        <Row label="Last pull" value={sy?.last_pull_at ? new Date(sy.last_pull_at).toLocaleString("en-GB") : "—"} />
        <Row label="Health updated" value={sy?.updated_at ? new Date(sy.updated_at).toLocaleString("en-GB") : "—"} />
      </dl>

      {hasError ? (
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">{sy!.last_error}</p>
      ) : null}

      {detail.devices.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-black text-stone-700">Devices</p>
          <ul className="mt-1 space-y-1 text-xs text-stone-600">
            {detail.devices.map((d) => (
              <li key={d.id} className="rounded-lg bg-stone-50 px-2 py-1.5">
                {d.label || d.device_fingerprint.slice(0, 12)} · {d.app_version ?? "—"} ·{" "}
                {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString("en-GB") : "never"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 rounded-xl px-3 py-2 ${highlight ? "bg-amber-50" : "bg-stone-50"}`}>
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className="max-w-[55%] text-right font-mono text-xs font-black text-stone-900">{value}</dd>
    </div>
  );
}
