import { Loader2, RefreshCw } from "lucide-react";
import type { AiHealthReport } from "../../../lib/ai/aiHealthCheck";

type Props = {
  report: AiHealthReport | null;
  loading: boolean;
  onRefresh: () => void;
};

function statusIcon(status: "ok" | "fail" | "warn"): string {
  if (status === "ok") return "🟢";
  if (status === "warn") return "🟡";
  return "🔴";
}

function failingSummary(report: AiHealthReport): string {
  const fails = report.components.filter((c) => c.status === "fail");
  if (fails.length === 0) {
    const warns = report.components.filter((c) => c.status === "warn");
    if (warns.length > 0) return warns.map((w) => w.label).join(", ");
    return "";
  }
  return fails.map((f) => f.label).join(", ");
}

export function AiStatusCard({ report, loading, onRefresh }: Props) {
  const healthy = report?.healthy === true;
  const hasFails = report?.components.some((c) => c.status === "fail") ?? false;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-stone-800">AI Status</h2>
          <p className="mt-1 text-xs font-semibold text-stone-500">
            Infrastructure check — edge functions, secrets, and database RPCs.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex min-h-[36px] items-center gap-1 rounded-lg border border-stone-200 px-3 text-xs font-bold text-stone-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      {loading && !report ? (
        <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-stone-600">
          <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
          Running health check…
        </div>
      ) : null}

      {report ? (
        <div className="mt-4 space-y-3">
          <div
            className={`rounded-xl px-4 py-3 ${
              healthy ? "border border-emerald-200 bg-emerald-50" : "border border-rose-200 bg-rose-50"
            }`}
          >
            <p className="text-base font-black text-stone-900">
              {healthy ? "🟢 AI Healthy" : hasFails ? "🔴 Deployment Required" : "🟡 AI Degraded"}
            </p>
            {!healthy && failingSummary(report) ? (
              <p className="mt-1 text-sm font-semibold text-rose-900">
                Failing: {failingSummary(report)}
              </p>
            ) : null}
            <p className="mt-1 text-[11px] font-semibold text-stone-500">
              Last checked {new Date(report.checkedAt).toLocaleString()}
            </p>
          </div>

          <ul className="space-y-1.5">
            {report.components.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-stone-100 bg-stone-50 px-3 py-2 text-sm"
              >
                <span className="font-semibold text-stone-800">
                  {statusIcon(c.status)} {c.label}
                </span>
                {c.detail ? (
                  <span className="max-w-[55%] text-right text-xs font-medium text-stone-600">{c.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>

          {hasFails ? (
            <p className="text-xs font-semibold text-stone-600">
              Deploy AI functions: <code className="rounded bg-stone-100 px-1">npm run supabase:deploy:ai</code>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
