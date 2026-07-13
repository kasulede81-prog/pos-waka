/**
 * Phase 24.1A — startup timeline metrics ([waka-performance]).
 * No user information is logged.
 */

export type StartupPerfPhase =
  | "auth_ready"
  | "critical_hydrate_start"
  | "critical_hydrate_end"
  | "shell_render"
  | "first_interactive"
  | "interactive_hydrate_end"
  | "dashboard_ready"
  | "background_hydrate_end"
  | "background_complete";

type Mark = { phase: StartupPerfPhase; elapsedMs: number; at: string };

const originMs = typeof performance !== "undefined" ? performance.now() : 0;
const marks: Mark[] = [];

function shouldLog(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return globalThis.localStorage?.getItem("waka.performance.log") === "1";
  } catch {
    return false;
  }
}

export function markStartupPerf(phase: StartupPerfPhase): void {
  const elapsedMs = Math.round(performance.now() - originMs);
  marks.push({ phase, elapsedMs, at: new Date().toISOString() });
  if (shouldLog()) {
    console.info(`[waka-performance] ${phase}=${elapsedMs}ms`);
  }
}

export function readStartupPerfMarks(): readonly Mark[] {
  return marks;
}

export function resetStartupPerfMarks(): void {
  marks.length = 0;
}
