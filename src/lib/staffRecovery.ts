import type { StaffAccount } from "../types";
import { pullShopStaffFromCloud } from "./shopStaffCloud";

export function mergeStaffAccountsFromCloudPull(local: StaffAccount[], cloud: StaffAccount[]): StaffAccount[] {
  const map = new Map<string, StaffAccount>();
  for (const row of local) map.set(row.id, row);
  for (const row of cloud) map.set(row.id, row);
  return [...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function pullAndMergeStaffAccountsForRecovery(): Promise<number> {
  const pulled = await pullShopStaffFromCloud();
  if (!pulled?.length) return 0;
  const { usePosStore } = await import("../store/usePosStore");
  const state = usePosStore.getState();
  const merged = mergeStaffAccountsFromCloudPull(state.preferences.staffAccounts ?? [], pulled);
  usePosStore.setState({
    preferences: { ...state.preferences, staffAccounts: merged },
  });
  return merged.length;
}
