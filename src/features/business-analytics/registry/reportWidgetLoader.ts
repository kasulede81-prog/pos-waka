import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { ReportWidgetProps } from "./reportWidgetTypes";

export type LazyReportWidget = LazyExoticComponent<ComponentType<ReportWidgetProps>>;

export function lazyReportWidget(
  factory: () => Promise<{ default: ComponentType<ReportWidgetProps> }>,
): LazyReportWidget {
  return lazy(factory);
}
