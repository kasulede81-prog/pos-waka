import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { InvestigationWidgetProps } from "./investigationWidgetTypes";

export type LazyInvestigationWidget = LazyExoticComponent<ComponentType<InvestigationWidgetProps>>;

/** Lazy-load investigation widgets to avoid unnecessary bundle weight. */
export function lazyInvestigationWidget(
  factory: () => Promise<{ default: ComponentType<InvestigationWidgetProps> }>,
): LazyInvestigationWidget {
  return lazy(factory);
}
