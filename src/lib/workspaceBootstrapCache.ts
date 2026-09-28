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

export function unmarkWorkspaceBootstrapped(userId: string): void {
  try {
    const next = { ...readSet() };
    if (!(userId in next)) return;
    delete next[userId];
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/**
 * Phase 1 — member workspace flag.
 *
 * A loyalty member is NOT a bootstrapped owner, so they must never receive the flag above: it is
 * read by merchant logic (`src/store/usePosStore.ts:10620`, which uses it to force
 * `preferences.onboardingDone = true` and `onboardingWizardDone = true`) and by the owner repair
 * path in `useAuth`. Writing it for a member would assert that a shop exists and has finished
 * onboarding when neither is true.
 *
 * Members get their own marker instead, purely so the app can avoid re-classifying on every pass.
 */
const MEMBER_KEY = "waka.workspace.member.v1";

function readMemberSet(): Record<string, true> {
  try {
    const raw = localStorage.getItem(MEMBER_KEY);
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

export function isMemberWorkspace(userId: string): boolean {
  return Boolean(readMemberSet()[userId]);
}

export function markMemberWorkspace(userId: string): void {
  try {
    const next = { ...readMemberSet(), [userId]: true as const };
    localStorage.setItem(MEMBER_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function unmarkMemberWorkspace(userId: string): void {
  try {
    const next = { ...readMemberSet() };
    if (!(userId in next)) return;
    delete next[userId];
    localStorage.setItem(MEMBER_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
