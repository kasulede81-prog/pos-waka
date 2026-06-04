import { useCallback, useEffect, useState } from "react";
import { fetchAdminPasswordResetAudit, type OpsAuditRow } from "../../lib/wakaInternalAdmin";
import { internalAdminShopHref } from "../../lib/internalAdminPreview";

type Props = {
  previewMode: boolean;
};

function formatAction(action: string): string {
  return action.replace(/_/g, " ");
}

function payloadHint(row: OpsAuditRow): string {
  const p = row.payload ?? {};
  if (typeof p.owner_email === "string") return p.owner_email;
  if (typeof p.detail === "string") return p.detail;
  if (typeof p.note === "string") return p.note;
  return "";
}

export function AdminPasswordResetLogPanel({ previewMode }: Props) {
  const [rows, setRows] = useState<OpsAuditRow[]>([]);
  const [loading, setLoading] = useState(!previewMode);

  const load = useCallback(async () => {
    if (previewMode) {
      setRows([
        {
          id: "preview-1",
          actor: null,
          action: "admin_request_owner_password_reset",
          target_shop_id: "preview-shop-demo",
          target_org_id: null,
          payload: { owner_email: "owner@example.com" },
          created_at: new Date().toISOString(),
        },
      ]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const list = await fetchAdminPasswordResetAudit(40);
    setRows(list);
    setLoading(false);
  }, [previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">Audit trail</p>
          <h2 className="text-base font-black text-stone-900">Admin password resets</h2>
          <p className="mt-1 text-xs text-stone-600">
            Email requests, direct password sets, and delivery success/failure. Apply migration{" "}
            <span className="font-mono">093</span> if the list stays empty.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="shrink-0 rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold text-stone-700"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-stone-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">No password reset events recorded yet.</p>
      ) : (
        <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2.5 text-xs">
              <p className="font-black text-stone-900">{formatAction(row.action)}</p>
              <p className="mt-0.5 text-stone-600">
                {new Date(row.created_at).toLocaleString("en-GB", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
                {payloadHint(row) ? ` · ${payloadHint(row)}` : ""}
              </p>
              {row.target_shop_id ? (
                <a
                  href={internalAdminShopHref(row.target_shop_id, previewMode)}
                  className="mt-1 inline-block font-bold text-orange-700 underline-offset-2 hover:underline"
                >
                  Open shop
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
