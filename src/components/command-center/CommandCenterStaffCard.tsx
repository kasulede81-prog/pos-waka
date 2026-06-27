import { Link } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { StaffControlRow } from "../../lib/ownerCommandCenterBuilders";
import { formatShortUgx } from "../../lib/commandCenterPageView";

type Props = {
  lang: Language;
  rows: StaffControlRow[];
  periodLabel: string;
};

function initials(label: string): string {
  const parts = label.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  return (label[0] ?? "?").toUpperCase();
}

function riskClass(tier: StaffControlRow["riskTier"]): string {
  if (tier === "offender") return "bg-rose-100 text-rose-900";
  if (tier === "review") return "bg-amber-100 text-amber-900";
  return "bg-emerald-100 text-emerald-900";
}

function TrustRing({ score }: { score: number }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgb(245 245 244)" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke="rgb(16 185 129)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute text-xs font-black tabular-nums text-emerald-800">{score}%</span>
    </div>
  );
}

export function CommandCenterStaffCard({ lang, rows, periodLabel }: Props) {
  const featured = rows.find((r) => r.hasActiveShift) ?? rows[0] ?? null;

  if (!featured) {
    return (
      <section className="rounded-3xl border border-stone-200/90 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black text-stone-950">{t(lang, "cmdCenterStaffTitle")}</h2>
        <p className="mt-2 text-sm font-semibold text-stone-500">{t(lang, "ownerShiftEmpty")}</p>
        <Link
          to="/office/open-shifts"
          className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center rounded-2xl border border-stone-200 text-xs font-black text-stone-900"
        >
          {t(lang, "ownerShiftViewAll")} →
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-stone-200/90 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-stone-950 sm:text-base">{t(lang, "cmdCenterStaffTitle")}</h2>
          <p className="text-[11px] font-semibold text-stone-500">{periodLabel}</p>
        </div>
        <Link to="/office/open-shifts" className="text-[11px] font-black text-waka-700">
          {t(lang, "cmdCenterAllShifts")} →
        </Link>
      </div>

      <div className="mt-3 flex gap-3 rounded-2xl bg-stone-50 p-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-waka-600 text-lg font-black text-white">
          {initials(featured.label)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-black text-stone-950">{featured.label}</p>
            <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-black", riskClass(featured.riskTier))}>
              {featured.riskTier === "trusted"
                ? t(lang, "ownerStaffRiskTrusted")
                : featured.riskTier === "review"
                  ? t(lang, "ownerStaffRiskReview")
                  : t(lang, "ownerStaffRiskOffender")}
            </span>
            {featured.hasActiveShift ? (
              <span className="rounded-full bg-waka-100 px-2 py-0.5 text-[10px] font-black uppercase text-waka-800">
                {t(lang, "ownerShiftActive")}
              </span>
            ) : null}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <TrustRing score={featured.riskScore} />
            <dl className="grid flex-1 grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerStaffColSales")}</dt>
                <dd className="font-black tabular-nums">{formatShortUgx(featured.salesUgx)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerStaffColVoids")}</dt>
                <dd className="font-black">{featured.voidCount}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerStaffColReturns")}</dt>
                <dd className="font-black">{featured.returnCount}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerStaffColDiscounts")}</dt>
                <dd className="font-black">{featured.discountCount}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {rows.length > 1 ? (
        <ul className="mt-3 space-y-1 border-t border-stone-100 pt-2">
          {rows.slice(1, 4).map((row) => (
            <li key={row.userId} className="flex items-center justify-between text-xs font-bold text-stone-700">
              <span>{row.label}</span>
              <span className="tabular-nums">{formatShortUgx(row.salesUgx)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
