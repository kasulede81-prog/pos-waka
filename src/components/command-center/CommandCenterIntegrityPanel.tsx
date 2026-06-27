import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { IntegritySignal } from "../../lib/ownerCommandCenterBuilders";

type Props = {
  lang: Language;
  signals: IntegritySignal[];
};

function statusEmoji(status: IntegritySignal["status"]): string {
  if (status === "critical") return "🔴";
  if (status === "warning") return "🟡";
  return "🟢";
}

function statusClass(status: IntegritySignal["status"]): string {
  if (status === "critical") return "border-rose-100 bg-rose-50/50";
  if (status === "warning") return "border-amber-100 bg-amber-50/50";
  return "border-emerald-100 bg-emerald-50/30";
}

export function CommandCenterIntegrityPanel({ lang, signals }: Props) {
  return (
    <section className="rounded-3xl border border-stone-200/90 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-stone-950 sm:text-base">{t(lang, "cmdCenterIntegrityTitle")}</h2>
          <p className="text-[11px] font-semibold text-stone-500">{t(lang, "ownerIntegritySub")}</p>
        </div>
        <Link to="/office/audit-center" className="text-[11px] font-black text-waka-700">
          {t(lang, "cmdCenterInvestigation")} →
        </Link>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {signals.map((sig) => (
          <li key={sig.id}>
            <Link
              to={sig.actionTo}
              className={clsx(
                "flex min-h-[56px] items-center gap-3 rounded-2xl border px-3 py-2 transition active:scale-[0.99]",
                statusClass(sig.status),
              )}
            >
              <span className="text-base" aria-hidden>
                {statusEmoji(sig.status)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-stone-900">{t(lang, sig.labelKey)}</p>
                <p className="truncate text-xs font-semibold text-stone-600">
                  {sig.detailVars ? tTemplate(lang, sig.detailKey, sig.detailVars) : t(lang, sig.detailKey)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
