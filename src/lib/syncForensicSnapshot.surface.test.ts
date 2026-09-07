import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSrc(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("sync forensic surfaces", () => {
  it("is available on owner/support pages only", () => {
    expect(readSrc("src/pages/SettingsSystemHealthPage.tsx")).toContain("SyncForensicSnapshotCard");
    expect(readSrc("src/pages/SettingsDiagnosticsPage.tsx")).toContain("SyncForensicSnapshotCard");
    expect(readSrc("src/pages/PilotSupportCenterPage.tsx")).toContain("SyncForensicSnapshotCard");
    expect(readSrc("src/pages/BackupSyncPage.tsx")).not.toContain("SyncForensicSnapshotCard");
  });

  it("does not wire snapshot load to flush or retry", () => {
    const helper = readSrc("src/lib/syncForensicSnapshot.ts");
    const card = readSrc("src/components/SyncForensicSnapshotCard.tsx");
    expect(helper).not.toContain("appendSyncOperation");
    expect(helper).not.toContain("removeSyncOperation");
    expect(helper).not.toContain("clearSyncQueue");
    expect(helper).not.toContain("flushPending");
    expect(helper).not.toContain("processCloudSync");
    expect(card).not.toContain("syncRetryNow");
    expect(card).not.toContain("backupSyncUploadNow");
    expect(card).not.toContain("flushPending");
  });
});
