import { useEffect, useMemo } from "react";
import { ShopTimelinePanel } from "../../ops/OpsWidgets";
import { AdminCollapsible } from "../../../adminUi";
import { buildShopConsoleIntel } from "../shopConsoleIntel";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

export function ShopConsoleActivityTab({ ctx }: Props) {
  const { detail, auditRowsLight, rescue, loadRescueData } = ctx;

  useEffect(() => {
    void loadRescueData();
  }, [loadRescueData]);

  const auditRows = rescue.loaded ? rescue.auditRows : auditRowsLight;

  const shopIntel = useMemo(() => {
    if (!detail) return null;
    return buildShopConsoleIntel(detail, auditRows);
  }, [detail, auditRows]);

  if (!detail || !shopIntel || shopIntel.timeline.length === 0) {
    return <p className="text-sm font-semibold text-stone-500">No activity events yet.</p>;
  }

  return (
    <AdminCollapsible title="Activity timeline" summary={`${shopIntel.timeline.length} events`} defaultOpen>
      <ShopTimelinePanel events={shopIntel.timeline} />
    </AdminCollapsible>
  );
}
