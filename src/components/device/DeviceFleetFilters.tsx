import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DeviceFleetFilter } from "../../lib/deviceFleetCatalog";

type Props = {
  lang: Language;
  filter: DeviceFleetFilter;
  search: string;
  onFilterChange: (filter: DeviceFleetFilter) => void;
  onSearchChange: (search: string) => void;
};

const FILTERS: DeviceFleetFilter[] = [
  "all",
  "current",
  "online",
  "offline",
  "pending",
  "approved",
  "disconnected",
  "revoked",
  "android",
  "windows",
  "web",
];

function filterLabel(lang: Language, item: DeviceFleetFilter): string {
  switch (item) {
    case "all":
      return t(lang, "deviceFleetFilterAll");
    case "current":
      return t(lang, "deviceFleetFilterCurrent");
    case "online":
      return t(lang, "deviceFleetFilterOnline");
    case "offline":
      return t(lang, "deviceFleetFilterOffline");
    case "pending":
      return t(lang, "deviceFleetFilterPending");
    case "approved":
      return t(lang, "deviceFleetFilterApproved");
    case "disconnected":
      return t(lang, "deviceFleetFilterDisconnected");
    case "revoked":
      return t(lang, "deviceFleetFilterRevoked");
    case "android":
      return "Android";
    case "windows":
      return "Windows";
    case "web":
      return "Web";
    case "ios":
      return "iOS";
    default:
      return item;
  }
}

export function DeviceFleetFilters({ lang, filter, search, onFilterChange, onSearchChange }: Props) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <label className="block text-sm font-bold text-foreground">
        {t(lang, "deviceFleetSearchLabel")}
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t(lang, "deviceFleetSearchPlaceholder")}
          className="mt-2 min-h-[44px] w-full rounded-xl border-2 border-border px-3 text-sm font-semibold outline-none ring-waka-300 focus:ring"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onFilterChange(item)}
            className={`rounded-full px-3 py-1.5 text-xs font-black ${
              filter === item ? "bg-waka-600 text-white" : "bg-muted text-muted-foreground"
            }`}
          >
            {filterLabel(lang, item)}
          </button>
        ))}
      </div>
    </div>
  );
}
