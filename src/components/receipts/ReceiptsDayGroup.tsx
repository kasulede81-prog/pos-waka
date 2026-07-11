import { useState, type ReactNode } from "react";
import { ChevronDown, FileDown } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";

type Props = {
  lang: Language;
  dateKey: string;
  dayHeading: string;
  saleCount: number;
  dayAmountLabel: string;
  defaultOpen?: boolean;
  tone?: "default" | "pending";
  onDownloadDay?: () => void;
  children: ReactNode;
};

export function ReceiptsDayGroup({
  lang,
  dateKey,
  dayHeading,
  saleCount,
  dayAmountLabel,
  defaultOpen = false,
  tone = "default",
  onDownloadDay,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const shellClass =
    tone === "pending"
      ? "group overflow-hidden rounded-[1.35rem] border border-amber-200/90 bg-amber-50/30 shadow-waka-sm"
      : "group overflow-hidden rounded-[1.35rem] border border-border/90 bg-card shadow-waka-sm open:ring-1 open:ring-waka-100";

  const chevronClass = tone === "pending" ? "text-amber-600" : "text-muted-foreground";

  return (
    <details
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className={shellClass}
      data-date-key={dateKey}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 marker:content-none [&::-webkit-details-marker]:hidden">
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform group-open:rotate-180 ${chevronClass}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-black text-foreground">{dayHeading}</p>
          <p className={`mt-0.5 text-sm font-medium ${tone === "pending" ? "text-amber-900" : "text-muted-foreground"}`}>
            {tTemplate(lang, "receiptsDayGroupMeta", {
              count: String(saleCount),
              amount: dayAmountLabel,
            })}
          </p>
        </div>
      </summary>
      {open ? (
        <div
          className={`space-y-2 border-t px-3 py-3 sm:px-4 ${
            tone === "pending" ? "border-amber-100" : "border-border bg-muted/50"
          }`}
        >
          {onDownloadDay ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onDownloadDay}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-card px-3 text-xs font-black text-waka-700 ring-1 ring-border"
              >
                <FileDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t(lang, "receiptsDownloadDayPdf")}
              </button>
            </div>
          ) : null}
          {children}
        </div>
      ) : null}
    </details>
  );
}
