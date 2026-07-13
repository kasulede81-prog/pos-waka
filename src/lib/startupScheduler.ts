/**
 * Phase 24.1A — prioritized startup background work queue.
 * Priority 0 = auth/shell (handled synchronously). This scheduler runs P1+.
 */

import { yieldUiTick } from "./uiYield";

export type StartupPriority = 1 | 2 | 3 | 4 | 5;

export type StartupTask = {
  id: string;
  priority: StartupPriority;
  run: () => void | Promise<void>;
};

const queue: StartupTask[] = [];
const scheduled = new Set<string>();
let draining = false;

export function scheduleStartupTask(task: StartupTask): void {
  if (scheduled.has(task.id)) return;
  scheduled.add(task.id);
  queue.push(task);
  queue.sort((a, b) => a.priority - b.priority);
  void drainStartupQueue();
}

export function resetStartupScheduler(): void {
  queue.length = 0;
  scheduled.clear();
  draining = false;
}

async function drainStartupQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const task = queue.shift()!;
      try {
        await task.run();
      } catch (e) {
        if (import.meta.env.DEV) console.warn("[waka-startup]", task.id, e);
      }
      await yieldUiTick();
    }
  } finally {
    draining = false;
    if (queue.length > 0) void drainStartupQueue();
  }
}
