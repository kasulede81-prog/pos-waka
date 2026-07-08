import clsx from "clsx";
import { MapPin } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { TransferLocation } from "../../../lib/transferWorkspace";
import { TransferHeader } from "./TransferHeader";
import { wizardChoiceButtonClass } from "./transferTokens";

type Props = {
  lang: Language;
  destinations: TransferLocation[];
  isSingleBranch: boolean;
  value: string | null;
  onChange: (id: string | null) => void;
};

export function TransferDestinationSelector({
  lang,
  destinations,
  isSingleBranch,
  value,
  onChange,
}: Props) {
  if (isSingleBranch) {
    return (
      <section className="rounded-2xl border border-dashed border-border/60 bg-muted/20 p-5 text-center">
        <MapPin className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mt-2 text-base font-black text-foreground">{t(lang, "xferDestinationSoonTitle")}</p>
        <p className="mt-1 text-sm font-semibold text-muted-foreground">{t(lang, "xferDestinationSoonSub")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <TransferHeader title={t(lang, "xferDestinationTitle")} />
      <p className="mt-1 text-xs font-semibold text-muted-foreground">{t(lang, "xferDestinationSub")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {destinations.map((dest) => (
          <button
            key={dest.id}
            type="button"
            onClick={() => onChange(dest.id)}
            className={clsx(wizardChoiceButtonClass(value === dest.id), "min-h-[56px] text-left text-sm")}
          >
            <span className="block font-black">{dest.name}</span>
            {dest.code ? <span className="text-xs font-semibold opacity-80">{dest.code}</span> : null}
          </button>
        ))}
      </div>
      {!value ? (
        <p className="mt-2 text-xs font-semibold text-muted-foreground">{t(lang, "xferDestinationSelectPh")}</p>
      ) : null}
    </section>
  );
}
