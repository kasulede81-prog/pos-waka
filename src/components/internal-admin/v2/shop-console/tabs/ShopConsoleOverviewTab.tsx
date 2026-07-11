import { useMemo } from "react";
import { WakaSwitch } from "../../../../enterprise/WakaSwitch";
import { formatDisplayEmail, formatLastActive, formatOwnerDisplayLabel, googleMapsDirectionsUrl } from "../../../../../lib/wakaInternalAdmin";
import { t } from "../../../../../lib/i18n";
import { formatWakaShopNumber } from "../../../../../lib/shopNumber";
import { buildShopConsoleIntel } from "../shopConsoleIntel";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

function vipCountdownLabel(currentPeriodEnd: string | null | undefined): string | null {
  if (!currentPeriodEnd) return null;
  const end = new Date(currentPeriodEnd).getTime();
  if (!Number.isFinite(end)) return null;
  const left = end - Date.now();
  if (left <= 0) return "VIP expired";
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const days = Math.floor(left / dayMs);
  const hours = Math.floor((left % dayMs) / hourMs);
  return `VIP ${days}d ${hours}h left`;
}

export function ShopConsoleOverviewTab({ ctx }: Props) {
  const { lang, detail, auditRowsLight, pilotCohort, togglePilotCohort, busy, canSupport, previewMode } = ctx;
  if (!detail) return null;

  const shopIntel = useMemo(
    () => buildShopConsoleIntel(detail, auditRowsLight),
    [detail, auditRowsLight],
  );

  const vipCountdown = useMemo(() => {
    const code = (detail.plan_code ?? detail.subscription?.plan_code ?? "").toLowerCase();
    if (code !== "waka_plus") return null;
    return vipCountdownLabel(detail.subscription?.current_period_end ?? null);
  }, [detail.plan_code, detail.subscription?.plan_code, detail.subscription?.current_period_end]);

  const ownerName = formatOwnerDisplayLabel({
    ownerFullName: detail.owner_full_name,
    ownerLabel: detail.owner_label,
  });
  const ownerEmail = formatDisplayEmail(detail.owner_email);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-waka-100 px-3 py-1 text-xs font-black text-waka-900">
          Health {shopIntel.health.score}%
        </span>
        {shopIntel.fraud.map((f) => (
          <span key={f} className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-800">
            {f}
          </span>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        {ownerName ? <p className="text-xs font-semibold text-muted-foreground">{ownerName}</p> : null}
        {ownerEmail ? <p className="text-xs font-semibold text-muted-foreground">{ownerEmail}</p> : null}
        <h2 className="mt-0.5 text-xl font-black text-foreground">{detail.shop.name}</h2>
        {formatWakaShopNumber(detail.shop.shop_number) ? (
          <p className="mt-1 font-mono text-sm font-black text-waka-700">
            Shop no. {formatWakaShopNumber(detail.shop.shop_number)}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] font-medium text-muted-foreground">ID {detail.shop.id}</p>
        <p className="mt-1 text-xs font-semibold text-muted-foreground">
          {[detail.shop.district, detail.shop.city].filter(Boolean).join(" · ") || "—"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
              formatLastActive(detail.shop.last_seen_at) === "Active now"
                ? "bg-emerald-100 text-emerald-900"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {formatLastActive(detail.shop.last_seen_at)}
          </span>
          <span className="rounded-full bg-waka-50 px-2.5 py-0.5 text-[10px] font-black text-waka-900">
            {detail.plan_code ?? detail.subscription?.plan_code ?? "free"}
          </span>
          <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[10px] font-black text-violet-900">
            {detail.product_count} {t(lang, "internalShopProfileProducts")}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-black text-muted-foreground">
            {detail.sale_count_30d} {t(lang, "internalShopProfileSales30d")}
          </span>
          {vipCountdown ? (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-900">
              {vipCountdown}
            </span>
          ) : null}
        </div>
        {detail.shop.phone_e164 ? (
          <p className="mt-1.5 font-mono text-xs text-muted-foreground">{detail.shop.phone_e164}</p>
        ) : null}
        {detail.shop.latitude != null &&
        detail.shop.longitude != null &&
        !Number.isNaN(detail.shop.latitude) &&
        !Number.isNaN(detail.shop.longitude) ? (
          <a
            href={googleMapsDirectionsUrl(detail.shop.latitude!, detail.shop.longitude!)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-[40px] items-center rounded-xl bg-waka-600 px-3 py-2 text-xs font-black text-white hover:bg-waka-700"
          >
            {t(lang, "internalVisitDirections")}
          </a>
        ) : null}
      </div>

      {canSupport && !previewMode ? (
        <div className="rounded-2xl border border-teal-200 bg-teal-50/60 px-4 py-3">
          <WakaSwitch
            checked={pilotCohort}
            disabled={busy}
            onCheckedChange={(next) => void togglePilotCohort(next)}
            label="Pilot cohort"
            description="Include in pilot dashboard and operational alerts."
          />
        </div>
      ) : null}
    </div>
  );
}
