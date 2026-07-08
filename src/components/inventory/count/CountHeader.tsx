import type { Language, InventoryCountSession } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { dateKeyKampala } from "../../../lib/datesUg";
import { COUNT_SECTION_LABEL } from "./countTokens";

type Props = {
  lang: Language;
  session: InventoryCountSession;
};

function statusLabel(lang: Language, status: string): string {
  return t(lang, `inventoryCountStatus_${status}`);
}

export function CountHeader({ lang, session }: Props) {
  const businessDate = session.snapshotCreatedAt
    ? dateKeyKampala(new Date(session.snapshotCreatedAt))
    : dateKeyKampala(new Date());
  const counterName = session.startedByName ?? session.startedBy ?? "—";
  const startedAt = session.startedAt ? new Date(session.startedAt).toLocaleString() : "—";

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={COUNT_SECTION_LABEL}>{t(lang, "cntHeaderSession")}</p>
          <p className="text-lg font-black text-foreground">
            {tTemplate(lang, "inventoryCountSessionNumber", { n: String(session.sessionNumber) })}
          </p>
        </div>
        <span className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-black text-primary">
          {statusLabel(lang, session.status)}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="font-semibold text-muted-foreground">{t(lang, "receiveSummaryBusinessDate")}</dt>
          <dd className="font-black text-foreground">{businessDate}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">{t(lang, "cntHeaderCounter")}</dt>
          <dd className="font-black text-foreground">{counterName}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">{t(lang, "cntHeaderStarted")}</dt>
          <dd className="font-black text-foreground">{startedAt}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">{t(lang, "inventoryCountProductsCounted")}</dt>
          <dd className="font-black text-foreground">
            {session.lines.filter((l) => l.countedQty != null).length}/{session.lines.length}
          </dd>
        </div>
      </dl>
    </section>
  );
}
