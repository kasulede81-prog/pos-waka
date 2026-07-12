import clsx from "clsx";
import type { ReactNode } from "react";
import { statusTokens, type StatusKind } from "../../lib/statusTokens";
import { Body } from "./EnterpriseTypography";

export type EnterpriseFeedbackTone = Extract<StatusKind, "success" | "warning" | "danger" | "info" | "pending">;

type Props = {
  tone: EnterpriseFeedbackTone;
  children: ReactNode;
  className?: string;
  role?: "status" | "alert";
};

/**
 * Inline success / warning / error / info banner (Phase 22.5).
 */
export function EnterpriseFeedbackBanner({ tone, children, className, role = "status" }: Props) {
  return (
    <div role={role} className={clsx(statusTokens[tone].banner, className)}>
      <Body className="!font-semibold">{children}</Body>
    </div>
  );
}
