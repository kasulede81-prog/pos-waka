/** Non-blocking post-login work — failures must never block POS entry (Phase 20.6). */

import { refreshDeviceAuthorityContext } from "./deviceAuthority";
import { logActivationFailure, logActivationStage } from "./deviceActivationDiagnostics";
import { classifyActivationError } from "./deviceActivationDiagnostics";

export function schedulePostLoginBackgroundTasks(shopId: string): void {
  if (!shopId) return;
  logActivationStage("refresh", { shopId, background: true });

  void refreshDeviceAuthorityContext(shopId).catch((error) => {
    logActivationFailure("refresh", classifyActivationError(error), { shopId, background: true });
  });

  void import("./shopRecoveryOrchestration")
    .then(({ scheduleShopRecovery }) => scheduleShopRecovery("owner_login"))
    .catch((error) => {
      logActivationFailure("refresh", classifyActivationError(error), {
        shopId,
        task: "shop_security_pin_recovery",
        background: true,
      });
    });

  void import("./staffCacheSync").then(({ scheduleStaffCacheProvisioning }) => {
    scheduleStaffCacheProvisioning();
  });

  void import("./postAuthCloudHydrate")
    .then(({ hydrateAccountFromCloud }) => hydrateAccountFromCloud())
    .catch((error) => {
      console.warn("[waka-post-login]", "cloud_hydrate_failed", error);
    });

  void import("./updateEngine/EnterpriseUpdateEngine")
    .then(({ EnterpriseUpdateEngine }) => EnterpriseUpdateEngine.evaluate("startup"))
    .catch((error) => {
      console.warn("[waka-post-login]", "release_policy_failed", error);
    });
}

/** Retry owner device enrollment without blocking POS (Phase 20.6). */
export function scheduleOwnerDeviceEnrollment(shopId: string): void {
  if (!shopId) return;
  logActivationStage("register", { shopId, background: true, ownerRetry: true });
  void import("./deviceActivation")
    .then(({ resolveLoginDeviceActivation }) => resolveLoginDeviceActivation(shopId))
    .catch((error) => {
      logActivationFailure("register", classifyActivationError(error), {
        shopId,
        background: true,
        ownerRetry: true,
      });
    });
}
