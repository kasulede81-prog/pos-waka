import { isElectronDesktop } from "../electronDesktop";
import { evaluateWebEligibility } from "./UpdateEligibility";
import type {
  PlatformAdapterCallbacks,
  PlatformEvaluationResult,
  PlatformUpdateContext,
  UpdatePlatformAdapter,
} from "./UpdatePlatformAdapter";

const PWA_UPDATE_EVENT = "waka:pwa-update";

export class WebUpdateAdapter implements UpdatePlatformAdapter {
  readonly platform = "web" as const;
  private pwaUpdatePending = false;

  initialize(callbacks: PlatformAdapterCallbacks): () => void {
    if (isElectronDesktop()) return () => undefined;
    const onPwaUpdate = () => {
      this.pwaUpdatePending = true;
      callbacks.onPlatformSignal("platform");
    };
    window.addEventListener(PWA_UPDATE_EVENT, onPwaUpdate);
    return () => window.removeEventListener(PWA_UPDATE_EVENT, onPwaUpdate);
  }

  isPwaUpdatePending(): boolean {
    return this.pwaUpdatePending;
  }

  markPwaUpdateSeen(): void {
    this.pwaUpdatePending = false;
  }

  async evaluate(context: PlatformUpdateContext): Promise<PlatformEvaluationResult> {
    return evaluateWebEligibility({
      ...context,
      pwaUpdatePending: this.pwaUpdatePending,
    });
  }

  reloadWebApp(): void {
    this.pwaUpdatePending = false;
    window.location.reload();
  }
}

export const webUpdateAdapter = new WebUpdateAdapter();
