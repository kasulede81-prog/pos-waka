import { getActiveAccountKey } from "../offline/accountScope";
import { readEntityManifest } from "../offline/entityStore";
import { listAccountKeysInIndexedDb } from "../offline/localDb";
import { countTombstones, tombstonesFromManifest } from "./tombstoneDurability";
import {
  isDeletedOrganization,
  isDeletionPending,
  isOrganizationBlocked,
  readDeletionMarker,
  readWipeMarker,
} from "./organizationDeletionState";
import { listAccountNamespaceDiagnostics } from "./accountDataWipe";

export type DeletionSafetyDiagnosticSnapshot = {
  activeAccountKey: string | null;
  namespaces: Array<{ accountKey: string; backupCount: number }>;
  tombstoneProductCount: number;
  tombstoneSaleCount: number;
  deletionMarker: ReturnType<typeof readDeletionMarker>;
  wipeMarker: ReturnType<typeof readWipeMarker>;
  organizationBlocked: boolean;
  organizationDeleted: boolean;
  deletionPending: boolean;
  resurrectionRisks: string[];
  wipeReady: boolean;
};

export async function buildDeletionSafetyDiagnosticSnapshot(): Promise<DeletionSafetyDiagnosticSnapshot> {
  const activeAccountKey = getActiveAccountKey();
  const namespaces = await listAccountNamespaceDiagnostics();
  const manifest = await readEntityManifest();
  const tombstones = countTombstones(tombstonesFromManifest(manifest));
  const deletionMarker = activeAccountKey ? readDeletionMarker(activeAccountKey) : null;
  const wipeMarker = activeAccountKey ? readWipeMarker(activeAccountKey) : null;
  const organizationDeleted = isDeletedOrganization(activeAccountKey);
  const deletionPending = isDeletionPending(activeAccountKey);
  const organizationBlocked = isOrganizationBlocked(activeAccountKey);

  const resurrectionRisks: string[] = [];
  if (namespaces.length > 0 && !wipeMarker) {
    resurrectionRisks.push("local_namespaces_present");
  }
  if (namespaces.some((n) => n.backupCount > 0)) {
    resurrectionRisks.push("local_backups_present");
  }
  if (organizationDeleted && namespaces.length > 0) {
    resurrectionRisks.push("deleted_org_with_local_data");
  }
  if (tombstones.products === 0 && (manifest?.tombstones ? Object.keys(manifest.tombstones).length === 0 : true)) {
    resurrectionRisks.push("no_product_tombstones_tracked");
  }

  const allKeys = await listAccountKeysInIndexedDb();
  const wipeReady = allKeys.length === 0 || Boolean(wipeMarker);

  return {
    activeAccountKey,
    namespaces,
    tombstoneProductCount: tombstones.products,
    tombstoneSaleCount: tombstones.sales,
    deletionMarker,
    wipeMarker,
    organizationBlocked,
    organizationDeleted,
    deletionPending,
    resurrectionRisks,
    wipeReady,
  };
}
