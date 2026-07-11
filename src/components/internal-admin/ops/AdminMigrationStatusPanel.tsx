import { useEffect, useState } from "react";
import { fetchMigrationStatus, type MigrationStatusRow } from "../../../lib/internalOpsHardening";

export function AdminMigrationStatusPanel() {
  const [rows, setRows] = useState<MigrationStatusRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchMigrationStatus().then((r) => {
      setRows(r);
      setLoading(false);
    });
  }, []);

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-black text-foreground">Migration visibility</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Server-side markers for pilot-critical migrations.</p>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Checking…</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2">
              <span className="font-mono text-xs font-bold text-foreground">{m.id}</span>
              <StatusBadge status={m.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "applied"
      ? "bg-emerald-100 text-emerald-900"
      : status === "missing"
        ? "bg-rose-100 text-rose-900"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${cls}`}>{status}</span>;
}
