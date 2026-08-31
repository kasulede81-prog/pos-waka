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
 * HOME CINEMATIC DENSITY V1 — staggered enter via CSS (respects reduced-motion).
 */
export function HomeOrderedRegions({ order, packExecutiveScan, renderRegion }: Props) {
  const nodes: ReactNode[] = [];
  let enterIndex = 0;
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i];
    if (!id) continue;
    if (packExecutiveScan && id === "kpi" && order[i + 1] === "health") {
      const delay = Math.min(enterIndex, 6);
      enterIndex += 1;
      nodes.push(
        <div
          key="home-executive-scan"
          data-home-region="executive-scan"
          className={`home-region-enter home-region-enter--${delay} mb-2.5 grid grid-cols-2 items-start gap-2.5 sm:mb-3 sm:gap-3 [&_section]:mb-0`}
        >
          <div data-home-region="kpi">{renderRegion("kpi")}</div>
          <div data-home-region="health">{renderRegion("health")}</div>
        </div>,
      );
      i += 1;
      continue;
    }
    const delay = Math.min(enterIndex, 6);
    enterIndex += 1;
    nodes.push(
      <Fragment key={id}>
        <div data-home-region={id} className={`home-region-enter home-region-enter--${delay}`}>
          {renderRegion(id)}
        </div>
      </Fragment>,
    );
  }
  return <>{nodes}</>;
}
