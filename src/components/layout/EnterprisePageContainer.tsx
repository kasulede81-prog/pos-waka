import clsx from "clsx";
import type { ReactNode } from "react";

type Variant = "default" | "workspace" | "viewport" | "flush";

type Props = {
  children: ReactNode;
  className?: string;
  /** Fills available flex height with internal overflow hidden (for viewport-locked pages). */
  variant?: Variant;
  as?: "div" | "section" | "main";
};

const VARIANT_CLASS: Record<Variant, string> = {
  default: "enterprise-page space-y-4",
  workspace: "enterprise-page enterprise-page--workspace space-y-3",
  viewport: "enterprise-page enterprise-page--viewport flex h-full min-h-0 flex-1 flex-col overflow-hidden",
  flush: "enterprise-page enterprise-page--flush min-w-0 max-w-full",
};

/**
 * Standard page root — inherits safe areas, overflow containment, and spacing.
 * Do not add manual pb-24; bottom chrome padding comes from `.enterprise-page` CSS.
 */
export function EnterprisePageContainer({
  children,
  className,
  variant = "default",
  as: Tag = "div",
}: Props) {
  return <Tag className={clsx(VARIANT_CLASS[variant], className)}>{children}</Tag>;
}
