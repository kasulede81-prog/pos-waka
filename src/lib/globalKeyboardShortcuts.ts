import { isEditableTextTarget } from "./posKeyboardShortcuts";

export type AdminShortcutAction =
  | "command-center"
  | "customers"
  | "support"
  | "platform"
  | "focus-search"
  | "refresh"
  | "back-to-customers";

export type ShortcutSequenceState = { awaitingGoKey: boolean; startedAt: number };

export const SHORTCUT_SEQUENCE_TIMEOUT_MS = 1200;

export function isShortcutBlocked(event: Pick<KeyboardEvent, "target" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  if (isEditableTextTarget(event.target)) return true;
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [aria-modal="true"]'));
}

export function resolveAdminShortcut(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
  state: ShortcutSequenceState,
  now: number,
): { action: AdminShortcutAction | null; state: ShortcutSequenceState } {
  const key = event.key.toLowerCase();
  const activeSequence = state.awaitingGoKey && now - state.startedAt <= SHORTCUT_SEQUENCE_TIMEOUT_MS;

  if (!activeSequence) {
    if (key === "g" && !event.shiftKey) return { action: null, state: { awaitingGoKey: true, startedAt: now } };
    if (key === "/") return { action: "focus-search", state: { awaitingGoKey: false, startedAt: 0 } };
    return { action: null, state: { awaitingGoKey: false, startedAt: 0 } };
  }

  const actions: Record<string, AdminShortcutAction> = {
    h: "command-center",
    c: "customers",
    s: "support",
    p: "platform",
    r: "refresh",
    b: "back-to-customers",
  };
  return {
    action: actions[key] ?? null,
    state: { awaitingGoKey: false, startedAt: 0 },
  };
}
