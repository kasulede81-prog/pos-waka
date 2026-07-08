import type { ReactNode } from "react";
import { ADJUST_SECTION_LABEL } from "./adjustmentTokens";

type Props = {
  title: string;
  action?: ReactNode;
};

export function AdjustmentHeader({ title, action }: Props) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className={ADJUST_SECTION_LABEL}>{title}</h3>
      {action}
    </div>
  );
}
