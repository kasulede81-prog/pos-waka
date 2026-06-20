let lastEntityPullErrors: Record<string, string> = {};

export function recordEntityPullErrors(errors: Record<string, string>): void {
  lastEntityPullErrors = { ...errors };
}

export function readLastEntityPullErrors(): Record<string, string> {
  return { ...lastEntityPullErrors };
}