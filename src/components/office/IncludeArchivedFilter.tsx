import { useTransition } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { WakaSwitch } from "../enterprise/WakaSwitch";

type Props = {
  lang: Language;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
};

export function IncludeArchivedFilter({ lang, checked, onChange, className = "" }: Props) {
  const [isPending, startTransition] = useTransition();

  return (
    <div
      className={`rounded-xl border border-border/90 bg-muted/90 px-3 py-2 ${isPending ? "opacity-80" : ""} ${className}`}
    >
      <WakaSwitch
        checked={checked}
        disabled={isPending}
        onCheckedChange={(value) => {
          startTransition(() => onChange(value));
        }}
        label={
          <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground sm:text-sm">
            {t(lang, "includeArchivedRecords")}
            {isPending ? (
              <span className="text-[10px] font-bold uppercase tracking-wide text-waka-700">
                {t(lang, "includeArchivedLoading")}
              </span>
            ) : null}
          </span>
        }
      />
    </div>
  );
}
