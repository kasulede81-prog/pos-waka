import { Search } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DateFilterValue } from "../../lib/dateFilters";
import { SalesHistoryDateFilterChips } from "../receipts/SalesHistoryDateFilterChips";
import { useSyncStatus } from "../../hooks/useSyncStatus";

type Props = {
  lang: Language;
  filter: DateFilterValue;
  onFilterChange: (next: DateFilterValue) => void;
  searchOpen: boolean;
  onSearchToggle: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  shopName: string;
};

function formatSyncAt(iso: string | null, lang: Language): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(lang === "lg" ? "lg-UG" : "en-UG", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function CommandCenterPageToolbar({
  lang,
  filter,
  onFilterChange,
  searchOpen,
  onSearchToggle,
  searchQuery,
  onSearchChange,
  shopName,
}: Props) {
  const sync = useSyncStatus();
  const lastSync = formatSyncAt(sync.health.lastSuccessAt, lang);
  const syncLabel =
    sync.pendingCount > 0
      ? t(lang, "cmdCenterSyncPending")
      : sync.syncing
        ? t(lang, "cmdCenterSyncUploading")
        : t(lang, "cmdCenterSyncComplete");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-muted-foreground">
          {syncLabel} · {t(lang, "cmdCenterLastSync")} {lastSync}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSearchToggle}
            className={clsx(
              "inline-flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm",
              searchOpen ? "border-waka-300 bg-waka-50 text-waka-700" : "border-border bg-card text-muted-foreground",
            )}
            aria-label={t(lang, "cmdCenterSearch")}
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="text-xs font-bold text-muted-foreground">{shopName}</p>

      <SalesHistoryDateFilterChips lang={lang} filter={filter} onFilterChange={onFilterChange} />

      {searchOpen ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t(lang, "cmdCenterSearchPlaceholder")}
            className="w-full rounded-2xl border border-border bg-card py-2.5 pl-10 pr-3 text-sm font-medium text-foreground shadow-sm outline-none ring-waka-500/30 focus:ring-2"
          />
        </div>
      ) : null}
    </div>
  );
}
