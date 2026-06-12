type LeaveGuard = {
  hasActiveSale: () => boolean;
  confirmLeave: () => Promise<boolean>;
};

let guard: LeaveGuard | null = null;

export function registerPosLeaveGuard(next: LeaveGuard): () => void {
  guard = next;
  return () => {
    if (guard === next) guard = null;
  };
}

export function hasActivePosSale(): boolean {
  return guard?.hasActiveSale() ?? false;
}

/** Returns true when navigation may proceed (no sale, or user confirmed). */
export async function confirmLeaveActiveSaleIfNeeded(): Promise<boolean> {
  if (!guard?.hasActiveSale()) return true;
  return guard.confirmLeave();
}
