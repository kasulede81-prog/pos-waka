import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { enterpriseIconClass, ENTERPRISE_ICON_STROKE } from "../../lib/enterpriseIcons";
import { enterpriseMotion } from "../../lib/enterpriseMotion";

type Size = "sm" | "md" | "lg";

const SIZE: Record<Size, string> = {
  sm: enterpriseIconClass("sm"),
  md: enterpriseIconClass("md"),
  lg: enterpriseIconClass("lg"),
};

type Props = {
  size?: Size;
  className?: string;
  label?: string;
};

/** Unified inline spinner — prefer skeletons for page-level loading. */
export function EnterpriseSpinner({ size = "md", className, label = "Loading" }: Props) {
  return (
    <span className={clsx("inline-flex items-center justify-center", className)} role="status" aria-label={label}>
      <Loader2 className={clsx(SIZE[size], enterpriseMotion.spin)} strokeWidth={ENTERPRISE_ICON_STROKE} aria-hidden />
    </span>
  );
}
