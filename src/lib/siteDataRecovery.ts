const CHUNK_RELOAD_KEY = "waka.chunk_reload_attempted";

/** One automatic reload per session when a lazy chunk fails after deploy. */
export function markChunkReloadAttempted(): void {
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function hasChunkReloadBeenAttempted(): boolean {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearChunkReloadAttempted(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

export async function unregisterServiceWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister()));
}

async function deleteIndexedDb(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

/** Clears cached POS data and auth session for this origin, then reloads. */
export async function resetWakaSiteDataAndReload(): Promise<void> {
  await unregisterServiceWorkers();
  await deleteIndexedDb("waka-pos-offline");

  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }

  window.location.reload();
}

export function isLikelyChunkLoadError(message: string): boolean {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed/i.test(
    message,
  );
}

/** Reload once when Vite/PWA serves mismatched bundles after a deploy. */
export function installChunkLoadRecovery(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    if (hasChunkReloadBeenAttempted()) return;
    markChunkReloadAttempted();
    void unregisterServiceWorkers().finally(() => window.location.reload());
  });

  window.addEventListener("error", (event) => {
    const message = event.message ?? "";
    if (!isLikelyChunkLoadError(message)) return;
    if (hasChunkReloadBeenAttempted()) return;
    event.preventDefault();
    markChunkReloadAttempted();
    void unregisterServiceWorkers().finally(() => window.location.reload());
  });
}
