import { Link } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { PageHeader } from "../components/layout/PageHeader";
import { useSessionActor } from "../context/SessionActorContext";
import { canInventoryCount } from "../lib/inventoryCount";

type Props = { lang: Language };

function statusLabel(lang: Language, status: string): string {
  const key = `inventoryCountStatus_${status}`;
  return t(lang, key);
}

export function InventoryCountSessionsPage({ lang }: Props) {
  const actor = useSessionActor();
  const sessions = usePosStore((s) => s.inventoryCountSessions);
  const createSession = usePosStore((s) => s.createInventoryCountSession);

  const canCreate = canInventoryCount(actor.role, "create");

  const sorted = [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const onCreate = () => {
    const r = createSession();
    if (!r.ok) {
      window.alert(t(lang, r.errorKey ?? "invalid"));
      return;
    }
    if (r.sessionId) {
      window.location.assign(`/stock/count/${r.sessionId}`);
    }
  };

  return (
    <div className="page-content-pad space-y-5">
      <PageHeader
        lang={lang}
        title={t(lang, "inventoryCountTitle")}
        subtitle={t(lang, "inventoryCountSub")}
        backLabel={t(lang, "navStock")}
        backFallback="/stock"
      />

      {canCreate ? (
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-4 py-4 text-base font-black text-white shadow-sm"
        >
          <Plus className="h-5 w-5" aria-hidden />
          {t(lang, "inventoryCountNew")}
        </button>
      ) : null}

      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-semibold text-slate-500">
          {t(lang, "inventoryCountEmpty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((s) => {
            const counted = s.lines.filter((l) => l.countedQty != null).length;
            return (
              <li key={s.id}>
                <Link
                  to={`/stock/count/${s.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                      <ClipboardList className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-slate-950">
                        {tTemplate(lang, "inventoryCountSessionNumber", { n: String(s.sessionNumber) })}
                      </p>
                      <p className="text-xs font-semibold text-slate-500">
                        {statusLabel(lang, s.status)} · {counted}/{s.lines.length}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-bold text-slate-400">
                    {s.snapshotCreatedAt ? new Date(s.snapshotCreatedAt).toLocaleDateString() : "—"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
