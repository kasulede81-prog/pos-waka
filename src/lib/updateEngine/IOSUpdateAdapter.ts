import { evaluatePlaceholderEligibility } from "./UpdateEligibility";
import type { PlatformEvaluationResult, PlatformUpdateContext, UpdatePlatformAdapter } from "./UpdatePlatformAdapter";

export class IOSUpdateAdapter implements UpdatePlatformAdapter {
  readonly platform = "ios" as const;

  async evaluate(context: PlatformUpdateContext): Promise<PlatformEvaluationResult> {
    return evaluatePlaceholderEligibility(context);
  }
}

export const iosUpdateAdapter = new IOSUpdateAdapter();
