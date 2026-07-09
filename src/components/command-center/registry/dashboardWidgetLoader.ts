import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { DashboardWidgetProps } from "./dashboardWidgetTypes";

export type LazyDashboardWidget = LazyExoticComponent<ComponentType<DashboardWidgetProps>>;

export function lazyDashboardWidget(
  factory: () => Promise<{ default: ComponentType<DashboardWidgetProps> }>,
): LazyDashboardWidget {
  return lazy(factory);
}
