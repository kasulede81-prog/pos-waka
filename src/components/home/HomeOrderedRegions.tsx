import { Fragment, type ReactNode } from "react";
import type { HomeBodyRegionId } from "../../lib/homePresentation";

type Props = {
  order: HomeBodyRegionId[];
  packExecutiveScan: boolean;
  renderRegion: (id: HomeBodyRegionId) => ReactNode;
};

/**
 * Renders Home body regions in DOM order (keyboard = visual).
 * Optional lg-only KPI|Health pack wraps consecutive kpi+health without CSS `order`.
 */
export function HomeOrderedRegions({ order, packExecutiveScan, renderRegion }: Props) {
  const nodes: ReactNode[] = [];
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i];
    if (!id) continue;
    if (packExecutiveScan && id === "kpi" && order[i + 1] === "health") {
      nodes.push(
        <div
          key="home-executive-scan"
          data-home-region="executive-scan"
          className="mb-4 grid grid-cols-2 items-start gap-3 sm:mb-5 [&_section]:mb-0"
        >
          <div data-home-region="kpi">{renderRegion("kpi")}</div>
          <div data-home-region="health">{renderRegion("health")}</div>
        </div>,
      );
      i += 1;
      continue;
    }
    nodes.push(
      <Fragment key={id}>
        <div data-home-region={id}>{renderRegion(id)}</div>
      </Fragment>,
    );
  }
  return <>{nodes}</>;
}
