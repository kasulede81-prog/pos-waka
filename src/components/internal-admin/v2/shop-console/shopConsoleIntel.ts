import {
  buildShopTimelineFromDetail,
  computeShopHealth,
  detectFraudSignals,
} from "../../../../lib/internalOpsIntelligence";
import type { OpsAuditRow, ShopOpsDetail } from "../../../../lib/wakaInternalAdmin";

export function buildShopConsoleIntel(detail: ShopOpsDetail, auditRows: OpsAuditRow[]) {
  const health = computeShopHealth({
    id: detail.shop.id,
    name: detail.shop.name,
    district: detail.shop.district,
    city: detail.shop.city,
    is_active: detail.shop.is_active,
    created_at: detail.shop.created_at ?? "",
    plan_code: detail.plan_code,
    trial_days_left: null,
    last_seen_at: detail.shop.last_seen_at,
    sale_count_30d: detail.sale_count_30d,
    gps_missing: false,
  });
  const fraud = detectFraudSignals(detail);
  const timeline = [
    ...buildShopTimelineFromDetail(detail),
    ...auditRows.map((a) => ({
      id: a.id,
      at: a.created_at,
      timeLabel: new Date(a.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      message: `Admin: ${a.action.replace(/_/g, " ")}`,
      priority: "low" as const,
      kind: "system" as const,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return { health, fraud, timeline };
}
