import { Link, useNavigate } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../types";
import { t, tTemplate } from "../lib/i18n";
import { flushPendingPersist, usePosStore } from "../store/usePosStore";
import { PageHeader } from "../components/layout/PageHeader";
import { useSessionActor } from "../context/SessionActorContext";
import { canInventoryCount } from "../lib/inventoryCount";
import { InventoryCountShell } from "../components/inventory/count/InventoryCountShell";
import { CountProgress } from "../components/inventory/count/CountProgress";
import { CountStatusStrip } from "../components/inventory/count/CountStatusStrip";
import { WIZARD_BTN_FOOTER_BASE } from "../components/inventory/count/countTokens";

type Props = { lang: Language };

function statusLabel(lang: Language, status: string): string {
  return t(lang, `inventoryCountStatus_${status}`);
}

export function InventoryCountSessionsPage({ lang }: Props) {
  const navigate = useNavigate();
  const actor = useSessionActor();
  const sessions = usePosStore((s) => s.inventoryCountSessions);
  const createSession = usePosStore((s) => s.createInventoryCountSession);
  const startSession = usePosStore((s) => s.startInventoryCountSession);

  const canCreate = canInventoryCount(actor.role, "create");
  const sorted = [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const onCreate = () => {
    const r = createSession();
    if (!r.ok) {
      window.alert(t(lang, r.errorKey ?? "invalid"));
      return;
    }
    if (!r.sessionId) return;

    const started = startSession(r.sessionId);
    if (!started.ok) {
      window.alert(t(lang, started.errorKey ?? "invalid"));
      navigate(`/stock/count/${r.sessionId}`);
      return;
    }

    flushPendingPersist();
    navigate(`/stock/count/${r.sessionId}`);
  };

  return (
    <div className="page-content-pad space-y-4">
      <PageHeader
        lang={lang}
        title={t(lang, "inventoryCountTitle")}
        subtitle={t(lang, "inventoryCountSub")}
        backLabel={t(lang, "navStock")}
        backFallback="/stock"
      />

      <InventoryCountShell
        lang={lang}
        variant="page"
        title={t(lang, "inventoryCountTitle")}
        subtitle={t(lang, "inventoryCountSub")}
        statusStrip={<CountStatusStrip lang={lang} />}
      >
        <CountProgress lang={lang} stage="choose" />

        {canCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className={clsx(
              WIZARD_BTN_FOOTER_BASE,
              "flex w-full items-center justify-center gap-2 bg-primary text-primary-foreground shadow-md hover:bg-primary/90",
            )}
          >
            <Plus className="h-5 w-5" aria-hidden />
            {t(lang, "inventoryCountNew")}
          </button>
        ) : null}

        {sorted.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-4 py-12 text-center text-sm font-semibold text-muted-foreground">
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
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-4 shadow-sm transition-colors hover:bg-muted/30"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <ClipboardList className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-base font-black text-foreground">
                          {tTemplate(lang, "inventoryCountSessionNumber", { n: String(s.sessionNumber) })}
                        </p>
                        <p className="text-xs font-semibold text-muted-foreground">
                          {statusLabel(lang, s.status)} · {counted}/{s.lines.length}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-muted-foreground">
                      {s.snapshotCreatedAt ? new Date(s.snapshotCreatedAt).toLocaleDateString() : "—"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </InventoryCountShell>
    </div>
  );
}
