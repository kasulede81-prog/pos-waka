import { isNativeApp } from "./nativeApp";

let interactionPromise: Promise<void> | null = null;
let interactionResolved = false;

/** Resolves on first tap/key, or after timeout. Used to defer non-essential startup sync on native. */
export function waitForFirstUserInteraction(timeoutMs = isNativeApp() ? 12_000 : 4_000): Promise<void> {
  if (interactionResolved) return Promise.resolve();
  if (interactionPromise) return interactionPromise;

  interactionPromise = new Promise((resolve) => {
    const finish = () => {
      if (interactionResolved) return;
      interactionResolved = true;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.removeEventListener("pointerdown", finish);
      window.removeEventListener("keydown", finish);
      window.removeEventListener("touchstart", finish);
    };
    window.addEventListener("pointerdown", finish, { once: true, passive: true });
    window.addEventListener("keydown", finish, { once: true });
    window.addEventListener("touchstart", finish, { once: true, passive: true });
    window.setTimeout(finish, timeoutMs);
  });

  return interactionPromise;
}

export function hasUserInteracted(): boolean {
  return interactionResolved;
}
