import { isPosSellPath, lockPosAfterSellExit } from "./posSellExit";
import { confirmLeaveActiveSaleIfNeeded } from "./posLeaveGuard";

export type PosExitChoice = "lock" | "continue" | "cancel";

type PosExitHandler = {
  confirmPosExit: () => Promise<PosExitChoice>;
};

let exitHandler: PosExitHandler | null = null;

export function registerPosExitHandler(handler: PosExitHandler): () => void {
  exitHandler = handler;
  return () => {
    if (exitHandler === handler) exitHandler = null;
  };
}

/**
 * When leaving the POS sell screen: confirm active cart, then prompt that the shift stays open.
 * Returns true when navigation may proceed.
 */
export async function confirmLeavePosIfNeeded(fromPath: string, toPath: string): Promise<boolean> {
  if (!isPosSellPath(fromPath) || isPosSellPath(toPath)) return true;
  if (!(await confirmLeaveActiveSaleIfNeeded())) return false;
  if (!exitHandler) {
    lockPosAfterSellExit();
    return true;
  }
  const choice = await exitHandler.confirmPosExit();
  if (choice === "cancel") return false;
  if (choice === "lock") lockPosAfterSellExit();
  return true;
}
