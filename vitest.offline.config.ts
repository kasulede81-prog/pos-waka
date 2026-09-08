import os from "node:os";
import { defineConfig } from "vitest/config";

/**
 * PHASE 0A — executable offline/sync test project.
 *
 * The default project (`vite.config.ts` → `npm test`) loads
 * `src/test/vitest.setup.ts`, which applies a GLOBAL `vi.mock` to
 * `src/offline/localDb`. That mock makes `readSyncQueue()` resolve `[]` and
 * turns `appendSyncOperation` / `removeSyncOperation` / `writeSnapshot` into
 * no-ops, so no test in that project can ever execute the real offline layer.
 *
 * This project exists so that offline behaviour CAN be executed:
 *   - real IndexedDB, provided by `fake-indexeddb`
 *   - the real `src/offline/localDb` and `src/offline/entityStore` modules
 *   - the real `pullCloudAndMergeIntoStore` / `flushSyncQueue` callers
 *
 * Only the network boundary (`src/lib/supabase`) is faked, per test file.
 *
 * Opt-in by filename: `*.offline.test.ts`. The default project excludes that
 * pattern, so the existing 640 test files are completely unaffected.
 *
 * Run with: `npm run test:offline`
 */
// No Vite plugins: this project only ever loads `.ts` modules, and esbuild
// already reads `jsx` from tsconfig for any `.tsx` pulled in transitively.
// Adding @vitejs/plugin-react here also collides with the vite 8 (rolldown) vs
// vitest-bundled-vite plugin types under `tsc -b`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.offline.test.ts"],
    setupFiles: ["src/test/vitest.offline.setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "threads",
    maxWorkers: Math.min(2, os.cpus().length),
    // Each file gets its own fake IndexedDB instance; serialise anyway so a
    // failure is attributable to one file and never to worker interleaving.
    fileParallelism: false,
    teardownTimeout: 5_000,
    restoreMocks: true,
    clearMocks: true,
  },
});
