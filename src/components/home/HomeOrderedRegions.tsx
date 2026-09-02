import { Fragment, type ReactNode } from "react";
import type { HomeBodyRegionId } from "../../lib/homePresentation";

type Props = {
  order: HomeBodyRegionId[];
  packExecutiveScan: boolean;
  /** Desktop command deck: Primary work | Reports visualization. */
  packCommandDeck?: boolean;
  renderRegion: (id: HomeBodyRegionId) => ReactNode;
  /** Live Business Floor — sits between the command deck / reports and Operations. */
  renderLiveFloor?: () => ReactNode;
};

/**
 * Renders Home body regions in DOM order (keyboard = visual).
 * Optional lg-only KPI|Health pack wraps consecutive kpi+health without CSS `order`.
 * HOME CINEMATIC V2 — command deck packs primary+reports; staggered enter via CSS.
 */
export function HomeOrderedRegions({
  order,
  packExecutiveScan,
  packCommandDeck = false,
  renderRegion,
  renderLiveFloor,
}: Props) {
  const nodes: ReactNode[] = [];
  let enterIndex = 0;
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i];
    if (!id) continue;
    if (packCommandDeck && id === "primary") {
      const delay = Math.min(enterIndex, 6);
      enterIndex += 1;
      const hasReports = order[i + 1] === "reports";
      const after = order.slice(i + (hasReports ? 2 : 1));
      const rest = after.filter((rid) => rid === "operations" || rid === "admin");
      const skip = (hasReports ? 1 : 0) + rest.length;
      nodes.push(
        <div key="home-viewport-stage" className="contents">
          <div
            data-home-region="command-deck"
            className={`home-region-enter home-region-enter--${delay} home-command-deck home-stage__deck ${hasReports ? "" : "home-stage__deck--solo"}`}
          >
            <div data-home-region="primary" className="flex h-full min-w-0 flex-col">
              {renderRegion("primary")}
            </div>
            {hasReports ? (
              <div data-home-region="reports" className="flex h-full min-h-0 min-w-0 flex-col">
                {renderRegion("reports")}
              </div>
            ) : null}
          </div>
          {renderLiveFloor ? (
            <div
              data-home-region="live-floor"
              className={`home-region-enter home-region-enter--${Math.min(enterIndex, 6)}`}
            >
              {renderLiveFloor()}
            </div>
          ) : null}
          {rest.length > 0 ? (
            <div data-home-region="ops-band" className="home-stage__ops">
              {rest.map((rid) => (
                <div key={rid} data-home-region={rid} className="min-w-0">
                  {renderRegion(rid)}
                </div>
              ))}
            </div>
          ) : null}
        </div>,
      );
      i += skip;
      continue;
    }
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
    if (id === "reports" && renderLiveFloor) {
      const floorDelay = Math.min(enterIndex, 6);
      enterIndex += 1;
      nodes.push(
        <div
          key="home-live-floor"
          data-home-region="live-floor"
          className={`home-region-enter home-region-enter--${floorDelay}`}
        >
          {renderLiveFloor()}
        </div>,
      );
    }
  }
  return <>{nodes}</>;
}
