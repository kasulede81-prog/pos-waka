export type AdminNavGroupId = "operations" | "revenue" | "platform" | "people" | "system";

const STORAGE_KEY = "waka.admin.nav.groups";

export function readAdminNavGroupsExpanded(): Record<AdminNavGroupId, boolean> {
  const defaults: Record<AdminNavGroupId, boolean> = {
    operations: true,
    revenue: true,
    platform: false,
    people: false,
    system: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<AdminNavGroupId, boolean>>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function persistAdminNavGroupExpanded(groupId: AdminNavGroupId, expanded: boolean): void {
  try {
    const current = readAdminNavGroupsExpanded();
    current[groupId] = expanded;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
}
