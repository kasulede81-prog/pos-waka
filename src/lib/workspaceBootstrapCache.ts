const KEY = "waka.workspace.bootstrapped.v1";

function readSet(): Record<string, true> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, true> = {};
    for (const [id, v] of Object.entries(o)) {
      if (v === true && typeof id === "string") out[id] = true;
    }
    return out;
  } catch {
    return {};
  }
}

export function isWorkspaceBootstrapped(userId: string): boolean {
  return Boolean(readSet()[userId]);
}

export function markWorkspaceBootstrapped(userId: string): void {
  try {
    const next = { ...readSet(), [userId]: true as const };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
