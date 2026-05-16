import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import {
  opsListActivationRequests,
  opsResolveActivationRequest,
  type OpsActivationRow,
} from "../lib/businessActivation";

type Props = {
  lang: Language;
};

export function InternalActivationOpsPage({ lang }: Props) {
  const [rows, setRows] = useState<OpsActivationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [planCode, setPlanCode] = useState("business");
  const [expiresDays, setExpiresDays] = useState(365);
  const [maxDevices, setMaxDevices] = useState(3);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await opsListActivationRequests();
    setRows(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = async (id: string) => {
    setBusyId(id);
    setToast(null);
    const r = await opsResolveActivationRequest({
      requestId: id,
      approve: true,
      planCode,
      expiresDays,
      maxDevices,
    });
    setBusyId(null);
    if (r.ok) {
      setToast(r.licenseKey ? `Issued ${r.licenseKey}` : "Approved.");
      window.dispatchEvent(new Event("waka:activation-updated"));
    } else setToast(r.message ?? "Approve failed.");
    await load();
  };

  const reject = async (id: string) => {
    setBusyId(id);
    setToast(null);
    const r = await opsResolveActivationRequest({ requestId: id, approve: false });
    setBusyId(null);
    if (r.ok) {
      setToast("Rejected.");
      window.dispatchEvent(new Event("waka:activation-updated"));
    } else setToast(r.message ?? "Reject failed.");
    await load();
  };

  return (
    <div className="space-y-6 pb-16 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-stone-900">{t(lang, "internalActivationsTitle")}</h1>
          <p className="mt-2 max-w-3xl text-sm font-medium leading-relaxed text-stone-600">
            {t(lang, "internalActivationsSub")}
          </p>
          <p className="mt-2 text-xs font-semibold text-stone-500">
            Menu: <span className="font-mono text-stone-700">/internal/waka/activations</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-2xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-stone-800 hover:bg-stone-50"
          >
            Refresh
          </button>
          <Link to="/internal/waka" className="rounded-2xl bg-stone-900 px-4 py-2 text-sm font-black text-white">
            ← {t(lang, "internalAdminBack")}
          </Link>
        </div>
      </div>

      <div className="grid gap-4 rounded-3xl border border-orange-100 bg-orange-50/50 p-5 sm:grid-cols-3">
        <label className="block text-xs font-black uppercase tracking-wide text-stone-600">
          {t(lang, "internalActivationsPlan")}
          <input
            value={planCode}
            onChange={(e) => setPlanCode(e.target.value)}
            className="mt-2 min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-3 font-semibold text-stone-900"
          />
        </label>
        <label className="block text-xs font-black uppercase tracking-wide text-stone-600">
          {t(lang, "internalActivationsDays")}
          <input
            type="number"
            min={1}
            max={3650}
            value={expiresDays}
            onChange={(e) => setExpiresDays(Number(e.target.value))}
            className="mt-2 min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-3 font-semibold text-stone-900"
          />
        </label>
        <label className="block text-xs font-black uppercase tracking-wide text-stone-600">
          {t(lang, "internalActivationsDevices")}
          <input
            type="number"
            min={1}
            max={999}
            value={maxDevices}
            onChange={(e) => setMaxDevices(Number(e.target.value))}
            className="mt-2 min-h-[44px] w-full rounded-xl border border-stone-200 bg-white px-3 font-semibold text-stone-900"
          />
        </label>
      </div>

      {toast ? (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{toast}</p>
      ) : null}

      {loading ? (
        <p className="text-sm font-medium text-stone-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-3xl border border-stone-200 bg-white px-6 py-12 text-center text-sm font-semibold text-stone-600">
          {t(lang, "internalActivationsEmpty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-stone-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-stone-100 bg-stone-50 text-xs font-black uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-3">Business</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r) => (
                <tr key={r.id} className="font-medium text-stone-800">
                  <td className="px-4 py-3 font-bold">{r.business_display_name}</td>
                  <td className="px-4 py-3 font-mono text-xs font-bold text-orange-800">{r.public_reference_code}</td>
                  <td className="px-4 py-3 text-xs font-bold capitalize text-stone-600">{r.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        disabled={busyId !== null || r.status !== "pending"}
                        onClick={() => void approve(r.id)}
                        className="rounded-xl bg-orange-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
                      >
                        {t(lang, "internalActivationsApprove")}
                      </button>
                      <button
                        type="button"
                        disabled={busyId !== null || r.status !== "pending"}
                        onClick={() => void reject(r.id)}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-900 disabled:opacity-40"
                      >
                        {t(lang, "internalActivationsReject")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
