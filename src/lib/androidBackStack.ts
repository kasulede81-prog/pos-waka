/**
 * Priority-ordered handlers for Android hardware back (lower = handled first).
 */
export const ANDROID_BACK_PRIORITY = {
  camera: 10,
  checkout: 20,
  productSheet: 30,
  modal: 35,
  menuDrawer: 40,
} as const;

type HandlerEntry = {
  priority: number;
  order: number;
  run: () => boolean;
};

const handlers = new Map<string, HandlerEntry>();
let registrationSeq = 0;

export function registerAndroidBackHandler(
  id: string,
  priority: number,
  run: () => boolean,
): () => void {
  const order = ++registrationSeq;
  handlers.set(id, { priority, order, run });
  return () => {
    handlers.delete(id);
  };
}

export function clearAndroidBackHandlers(): void {
  handlers.clear();
}

/** Returns true when a handler consumed the back press. */
export function dispatchAndroidBack(): boolean {
  const sorted = [...handlers.values()].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.order - a.order;
  });
  for (const entry of sorted) {
    if (entry.run()) return true;
  }
  return false;
}

export function androidBackHandlerCount(): number {
  return handlers.size;
}
