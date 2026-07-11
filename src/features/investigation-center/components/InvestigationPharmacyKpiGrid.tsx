import clsx from "clsx";
import {
  AlertTriangle,
  ClipboardList,
  FlaskConical,
  PackageX,
  Pill,
  RotateCcw,
  Shield,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { PharmacyInvestigationKpiCard, PharmacyInvestigationKpiId } from "../types";

type Props = {
  lang: Language;
  cards: PharmacyInvestigationKpiCard[];
  activeKpi: PharmacyInvestigationKpiId | null;
  periodLabel: string;
  onSelect: (id: PharmacyInvestigationKpiId) => void;
};

const ICONS: Record<PharmacyInvestigationKpiId, LucideIcon> = {
  rx_today: ClipboardList,
  medicines_dispensed: Pill,
  controlled_events: Shield,
  near_expiry: Timer,
  expired_medicines: PackageX,
  batch_writeoffs: FlaskConical,
  fefo_overrides: RotateCcw,
  compliance_alerts: AlertTriangle,
};

const TONE_CLASS: Record<PharmacyInvestigationKpiCard["iconTone"], string> = {
  orange: "bg-waka-50 text-waka-700 ring-waka-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  yellow: "bg-amber-50 text-amber-700 ring-amber-100",
  purple: "bg-violet-50 text-violet-700 ring-violet-100",
  red: "bg-rose-50 text-rose-700 ring-rose-100",
  slate: "bg-muted text-muted-foreground ring-border",
};

export function InvestigationPharmacyKpiGrid({ lang, cards, activeKpi, periodLabel, onSelect }: Props) {
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-2 px-0.5">
        <div>
          <h2 className="text-sm font-black text-foreground">{t(lang, "icPharmacyOverviewTitle")}</h2>
          <p className="text-[11px] font-semibold text-muted-foreground">{periodLabel}</p>
        </div>
      </div>
      <div className="-mx-0.5 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
        {cards.map((card) => {
          const Icon = ICONS[card.id];
          const active = activeKpi === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card.id)}
              className={clsx(
                "flex min-w-[132px] shrink-0 flex-col rounded-2xl border p-3 text-left shadow-sm transition-all active:scale-[0.98]",
                active
                  ? "border-violet-500 bg-violet-50/80 ring-2 ring-violet-200"
                  : "border-border/90 bg-card hover:border-border",
              )}
            >
              <div className={clsx("flex h-9 w-9 items-center justify-center rounded-xl ring-1", TONE_CLASS[card.iconTone])}>
                <Icon className="h-4 w-4" aria-hidden />
              </div>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{t(lang, card.labelKey)}</p>
              <p className="mt-0.5 text-xl font-black tabular-nums text-foreground">{card.value.toLocaleString()}</p>
              <p className="mt-1 truncate text-[10px] font-semibold text-muted-foreground">{periodLabel}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
