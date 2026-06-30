import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import type { IntegritySignal } from "../../lib/ownerCommandCenterBuilders";

type Props = {
  lang: Language;
  signals: IntegritySignal[];
};

function statusDot(status: IntegritySignal["status"]): string {
  if (status === "critical") return "bg-rose-500";
  if (status === "warning") return "bg-amber-400";
  return "bg-emerald-500";
}

function statusLabel(lang: Language, status: IntegritySignal["status"]): string {
  if (status === "critical") return t(lang, "ownerIntegrityStatusCritical");
  if (status === "warning") return t(lang, "ownerIntegrityStatusWarning");
  return t(lang, "ownerIntegrityStatusGreen");
}

export function OwnerIntegrityStrip({ lang, signals }: Props) {
  return (
    <section className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <h2 className="text-base font-black text-stone-950">{t(lang, "ownerIntegrityTitle")}</h2>
      <p className="mt-0.5 text-xs font-semibold text-stone-500">{t(lang, "ownerIntegritySub")}</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {signals.map((sig) => (
          <li key={sig.id}>
            <Link
              to={sig.actionTo}
              className="flex min-h-[56px] items-center gap-3 rounded-xl border border-stone-100 bg-stone-50 px-3 py-2 transition-colors hover:bg-stone-100"
            >
              <span className={`h-3 w-3 shrink-0 rounded-full ${statusDot(sig.status)}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-stone-900">{t(lang, sig.labelKey)}</p>
                <p className="text-xs font-semibold text-stone-600">
                  {sig.detailVars
                    ? tTemplate(lang, sig.detailKey, sig.detailVars)
                    : t(lang, sig.detailKey)}{" "}
                  · {statusLabel(lang, sig.status)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
