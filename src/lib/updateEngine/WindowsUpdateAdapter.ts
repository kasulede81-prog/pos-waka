import { evaluatePlaceholderEligibility } from "./UpdateEligibility";
import type { PlatformEvaluationResult, PlatformUpdateContext, UpdatePlatformAdapter } from "./UpdatePlatformAdapter";

export class WindowsUpdateAdapter implements UpdatePlatformAdapter {
  readonly platform = "windows" as const;

  async evaluate(context: PlatformUpdateContext): Promise<PlatformEvaluationResult> {
    return evaluatePlaceholderEligibility(context);
  }
}

export const windowsUpdateAdapter = new WindowsUpdateAdapter();
