/**
 * Shop catalog multi-device sync: node-level merge, tombstones, layout/pin/flag LWW.
 *
 * Conflict rules (deterministic):
 * - CatalogNode: merge by id. New id is added. Same id → newer updatedAt wins.
 *   Equal updatedAt → lexicographic (name|parentId|sortOrder|legacyShelfKey).
 * - Deleted id: tombstone always wins over a live row with the same id. An offline
 *   edit against a deleted node is rejected (not resurrected).
 * - Sibling reorder: each node's sortOrder travels with that node's updatedAt.
 *   Concurrent full reorders of the same parent: later batch wins per node
 *   (planReorder stamps every sibling). Concurrent unrelated children are unioned.
 * - Pins: per-key pinned+updatedAt LWW; order skeleton is the newer pinned_keys array,
 *   then remaining pinned keys.
 * - Layout: per shelf key LWW by updatedAt; layout tombstones win like node tombstones.
 * - catalogHierarchyEnabled: shop-level LWW by catalogHierarchyEnabledUpdatedAt.
 *   Toggling the flag does not destroy nodes.
 *
 * Tombstones older than 90 days may be dropped (matches server pull GC).
 */

import type {
  CatalogLayoutTombstone,
  CatalogNode,
  CatalogNodeTombstone,
  PinnedShelfKeyRevision,
  PosShelfLayoutConfig,
  ShopPreferences,
} from "../types";
import { normalizeCatalogNodes } from "./catalogHierarchy";
import { normalizePosShelfLayout } from "./posShelfLayout";
import { supabase } from "./supabase";

export const CATALOG_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type CatalogCloudDocument = {
  nodes: CatalogNode[];
  tombstones: CatalogNodeTombstone[];
  layout: Record<string, PosShelfLayoutConfig>;
  layoutTombstones: CatalogLayoutTombstone[];
  pinnedKeys: string[];
  pinnedKeysUpdatedAt: string;
  pinnedRevisions: Record<string, PinnedShelfKeyRevision>;
  catalogHierarchyEnabled: boolean;
  catalogHierarchyEnabledUpdatedAt: string;
};

export type CatalogPushResult = {
  ok: boolean;
  rejectedNodeIds: string[];
};

const EPOCH = "1970-01-01T00:00:00.000Z";

export function isoTimeMs(value: string | undefined | null): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function gcTombstones<T extends { deletedAt: string }>(rows: readonly T[], nowMs: number): T[] {
  return rows.filter((row) => nowMs - isoTimeMs(row.deletedAt) < CATALOG_TOMBSTONE_TTL_MS);
}

export function mergeTombstoneLists(
  local: readonly CatalogNodeTombstone[],
  remote: readonly CatalogNodeTombstone[],
  nowMs = Date.now(),
): CatalogNodeTombstone[] {
  const byId = new Map<string, CatalogNodeTombstone>();
  for (const row of [...local, ...remote]) {
    const id = row.id.trim();
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev || isoTimeMs(row.deletedAt) >= isoTimeMs(prev.deletedAt)) {
      byId.set(id, { id, deletedAt: row.deletedAt });
    }
  }
  return gcTombstones([...byId.values()], nowMs);
}

export function mergeLayoutTombstoneLists(
  local: readonly CatalogLayoutTombstone[],
  remote: readonly CatalogLayoutTombstone[],
  nowMs = Date.now(),
): CatalogLayoutTombstone[] {
  const byKey = new Map<string, CatalogLayoutTombstone>();
  for (const row of [...local, ...remote]) {
    const shelfKey = row.shelfKey.trim();
    if (!shelfKey) continue;
    const prev = byKey.get(shelfKey);
    if (!prev || isoTimeMs(row.deletedAt) >= isoTimeMs(prev.deletedAt)) {
      byKey.set(shelfKey, { shelfKey, deletedAt: row.deletedAt });
    }
  }
  return gcTombstones([...byKey.values()], nowMs);
}

function nodeTieBreak(a: CatalogNode, b: CatalogNode): CatalogNode {
  const sa = `${a.name}|${a.parentId ?? ""}|${a.sortOrder}|${a.legacyShelfKey}`;
  const sb = `${b.name}|${b.parentId ?? ""}|${b.sortOrder}|${b.legacyShelfKey}`;
  return sb > sa ? b : a;
}

export function pickNewerCatalogNode(a: CatalogNode, b: CatalogNode): CatalogNode {
  const am = isoTimeMs(a.updatedAt);
  const bm = isoTimeMs(b.updatedAt);
  if (bm !== am) return bm > am ? b : a;
  return nodeTieBreak(a, b);
}

/**
 * Merge live nodes by id. Tombstones always remove that id (no resurrection).
 * Incoming is a delta: ids not mentioned stay unless tombstoned.
 */
export function mergeCatalogNodes(input: {
  local: readonly CatalogNode[];
  incoming: readonly CatalogNode[];
  tombstones: readonly CatalogNodeTombstone[];
}): CatalogNode[] {
  const dead = new Set(input.tombstones.map((t) => t.id));
  const byId = new Map<string, CatalogNode>();
  for (const node of input.local) {
    if (dead.has(node.id)) continue;
    byId.set(node.id, node);
  }
  for (const node of input.incoming) {
    if (dead.has(node.id)) continue;
    const prev = byId.get(node.id);
    byId.set(node.id, prev ? pickNewerCatalogNode(prev, node) : node);
  }
  return [...byId.values()];
}

function layoutVisualSignature(config: PosShelfLayoutConfig | undefined): string {
  if (!config) return "";
  const { updatedAt: _omit, ...rest } = config;
  void _omit;
  return JSON.stringify(rest);
}

export function mergeShelfLayoutMaps(input: {
  local: Record<string, PosShelfLayoutConfig>;
  incoming: Record<string, PosShelfLayoutConfig>;
  tombstones: readonly CatalogLayoutTombstone[];
}): Record<string, PosShelfLayoutConfig> {
  const dead = new Set(input.tombstones.map((t) => t.shelfKey));
  const out: Record<string, PosShelfLayoutConfig> = {};
  const keys = new Set([...Object.keys(input.local), ...Object.keys(input.incoming)]);
  for (const key of keys) {
    if (dead.has(key)) continue;
    const a = input.local[key];
    const b = input.incoming[key];
    if (!a) {
      if (b) out[key] = b;
      continue;
    }
    if (!b) {
      out[key] = a;
      continue;
    }
    const am = isoTimeMs(a.updatedAt);
    const bm = isoTimeMs(b.updatedAt);
    if (bm > am) out[key] = b;
    else if (am > bm) out[key] = a;
    else out[key] = layoutVisualSignature(b) > layoutVisualSignature(a) ? b : a;
  }
  return out;
}

export function mergePinnedShelfState(input: {
  localKeys: readonly string[];
  localUpdatedAt?: string;
  localRevisions?: Record<string, PinnedShelfKeyRevision>;
  incomingKeys: readonly string[];
  incomingUpdatedAt?: string;
  incomingRevisions?: Record<string, PinnedShelfKeyRevision>;
}): {
  keys: string[];
  updatedAt: string;
  revisions: Record<string, PinnedShelfKeyRevision>;
} {
  const revisions: Record<string, PinnedShelfKeyRevision> = { ...(input.localRevisions ?? {}) };
  for (const [key, rev] of Object.entries(input.incomingRevisions ?? {})) {
    const prev = revisions[key];
    if (!prev || isoTimeMs(rev.updatedAt) >= isoTimeMs(prev.updatedAt)) {
      revisions[key] = rev;
    }
  }
  const localAt = input.localUpdatedAt ?? EPOCH;
  const incomingAt = input.incomingUpdatedAt ?? EPOCH;
  const newerKeys = isoTimeMs(incomingAt) >= isoTimeMs(localAt) ? input.incomingKeys : input.localKeys;
  const olderKeys = isoTimeMs(incomingAt) >= isoTimeMs(localAt) ? input.localKeys : input.incomingKeys;
  const seen = new Set<string>();
  const keys: string[] = [];
  const isPinned = (key: string): boolean => revisions[key]?.pinned !== false;
  for (const key of newerKeys) {
    if (!key || seen.has(key) || !isPinned(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  for (const key of olderKeys) {
    if (!key || seen.has(key) || !isPinned(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  for (const [key, rev] of Object.entries(revisions)) {
    if (!rev.pinned || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return {
    keys,
    updatedAt: isoTimeMs(incomingAt) >= isoTimeMs(localAt) ? incomingAt : localAt,
    revisions,
  };
}

export function pickHierarchyFlag(input: {
  local: boolean;
  localUpdatedAt?: string;
  incoming: boolean;
  incomingUpdatedAt?: string;
}): { enabled: boolean; updatedAt: string } {
  const localAt = input.localUpdatedAt ?? EPOCH;
  const incomingAt = input.incomingUpdatedAt ?? EPOCH;
  const localMs = isoTimeMs(localAt);
  const incomingMs = isoTimeMs(incomingAt);
  if (incomingMs > localMs) {
    return { enabled: input.incoming, updatedAt: incomingAt };
  }
  if (incomingMs < localMs) {
    return { enabled: input.local, updatedAt: localAt };
  }
  if (localMs === 0) {
    return { enabled: input.local, updatedAt: localAt };
  }
  return { enabled: input.incoming, updatedAt: incomingAt };
}

export function catalogDocumentFromPreferences(prefs: ShopPreferences): CatalogCloudDocument {
  return {
    nodes: normalizeCatalogNodes(prefs.posCatalogNodes ?? [], prefs.wakaShopId ?? "local"),
    tombstones: prefs.posCatalogTombstones ?? [],
    layout: normalizePosShelfLayout(prefs.posShelfLayout ?? {}),
    layoutTombstones: prefs.posShelfLayoutTombstones ?? [],
    pinnedKeys: [...(prefs.posPinnedShelfKeys ?? [])],
    pinnedKeysUpdatedAt: prefs.posPinnedShelfKeysUpdatedAt ?? EPOCH,
    pinnedRevisions: { ...(prefs.posPinnedShelfKeyRevisions ?? {}) },
    catalogHierarchyEnabled: prefs.catalogHierarchyEnabled === true,
    catalogHierarchyEnabledUpdatedAt: prefs.catalogHierarchyEnabledUpdatedAt ?? EPOCH,
  };
}

export function mergeCatalogDocuments(
  local: CatalogCloudDocument,
  incoming: CatalogCloudDocument,
  nowMs = Date.now(),
): CatalogCloudDocument {
  const tombstones = mergeTombstoneLists(local.tombstones, incoming.tombstones, nowMs);
  const layoutTombstones = mergeLayoutTombstoneLists(local.layoutTombstones, incoming.layoutTombstones, nowMs);
  const pins = mergePinnedShelfState({
    localKeys: local.pinnedKeys,
    localUpdatedAt: local.pinnedKeysUpdatedAt,
    localRevisions: local.pinnedRevisions,
    incomingKeys: incoming.pinnedKeys,
    incomingUpdatedAt: incoming.pinnedKeysUpdatedAt,
    incomingRevisions: incoming.pinnedRevisions,
  });
  const hierarchy = pickHierarchyFlag({
    local: local.catalogHierarchyEnabled,
    localUpdatedAt: local.catalogHierarchyEnabledUpdatedAt,
    incoming: incoming.catalogHierarchyEnabled,
    incomingUpdatedAt: incoming.catalogHierarchyEnabledUpdatedAt,
  });
  return {
    nodes: mergeCatalogNodes({ local: local.nodes, incoming: incoming.nodes, tombstones }),
    tombstones,
    layout: mergeShelfLayoutMaps({
      local: local.layout,
      incoming: incoming.layout,
      tombstones: layoutTombstones,
    }),
    layoutTombstones,
    pinnedKeys: pins.keys,
    pinnedKeysUpdatedAt: pins.updatedAt,
    pinnedRevisions: pins.revisions,
    catalogHierarchyEnabled: hierarchy.enabled,
    catalogHierarchyEnabledUpdatedAt: hierarchy.updatedAt,
  };
}

export function applyCatalogDocumentToPreferences(
  prefs: ShopPreferences,
  doc: CatalogCloudDocument,
): ShopPreferences {
  return {
    ...prefs,
    posCatalogNodes: doc.nodes,
    posCatalogTombstones: doc.tombstones,
    posShelfLayout: doc.layout,
    posShelfLayoutTombstones: doc.layoutTombstones,
    posPinnedShelfKeys: doc.pinnedKeys,
    posPinnedShelfKeysUpdatedAt: doc.pinnedKeysUpdatedAt,
    posPinnedShelfKeyRevisions: doc.pinnedRevisions,
    catalogHierarchyEnabled: doc.catalogHierarchyEnabled,
    catalogHierarchyEnabledUpdatedAt: doc.catalogHierarchyEnabledUpdatedAt,
  };
}

export const CATALOG_SYNC_PREF_KEYS: readonly (keyof ShopPreferences)[] = [
  "posCatalogNodes",
  "posShelfLayout",
  "posPinnedShelfKeys",
  "catalogHierarchyEnabled",
  "posCatalogTombstones",
  "posShelfLayoutTombstones",
  "posPinnedShelfKeyRevisions",
  "posPinnedShelfKeysUpdatedAt",
  "catalogHierarchyEnabledUpdatedAt",
];

export function preferencesPatchTouchesCatalog(patch: Partial<ShopPreferences>): boolean {
  return CATALOG_SYNC_PREF_KEYS.some((key) => key in patch);
}

export function appendCatalogTombstones(
  existing: readonly CatalogNodeTombstone[] | undefined,
  ids: readonly string[],
  deletedAt: string,
): CatalogNodeTombstone[] {
  return mergeTombstoneLists(existing ?? [], ids.filter(Boolean).map((id) => ({ id, deletedAt })));
}

export function appendLayoutTombstones(
  existing: readonly CatalogLayoutTombstone[] | undefined,
  keys: readonly string[],
  deletedAt: string,
): CatalogLayoutTombstone[] {
  return mergeLayoutTombstoneLists(
    existing ?? [],
    keys.filter(Boolean).map((shelfKey) => ({ shelfKey, deletedAt })),
  );
}

function revisionsFromPinChange(
  prevKeys: readonly string[],
  nextKeys: readonly string[],
  prevRevisions: Record<string, PinnedShelfKeyRevision> | undefined,
  now: string,
): Record<string, PinnedShelfKeyRevision> {
  const revisions = { ...(prevRevisions ?? {}) };
  const prevSet = new Set(prevKeys);
  const nextSet = new Set(nextKeys);
  for (const key of nextKeys) {
    if (!prevSet.has(key) || revisions[key]?.pinned !== true) {
      revisions[key] = { pinned: true, updatedAt: now };
    }
  }
  for (const key of prevKeys) {
    if (!nextSet.has(key)) {
      revisions[key] = { pinned: false, updatedAt: now };
    }
  }
  return revisions;
}

export function stampCatalogPreferencePatch(
  prev: ShopPreferences,
  patch: Partial<ShopPreferences>,
  now = new Date().toISOString(),
): Partial<ShopPreferences> {
  const next: Partial<ShopPreferences> = { ...patch };
  if (patch.posShelfLayout) {
    const prevLayout = prev.posShelfLayout ?? {};
    const stamped: Record<string, PosShelfLayoutConfig> = {};
    for (const [key, config] of Object.entries(patch.posShelfLayout)) {
      const prevConfig = prevLayout[key];
      const changed = layoutVisualSignature(prevConfig) !== layoutVisualSignature(config);
      stamped[key] = changed ? { ...config, updatedAt: config.updatedAt ?? now } : { ...config, updatedAt: config.updatedAt ?? prevConfig?.updatedAt };
    }
    next.posShelfLayout = stamped;
    const removed = Object.keys(prevLayout).filter((key) => !(key in patch.posShelfLayout!));
    if (removed.length > 0) {
      next.posShelfLayoutTombstones = appendLayoutTombstones(
        patch.posShelfLayoutTombstones ?? prev.posShelfLayoutTombstones,
        removed,
        now,
      );
    }
  }
  if (patch.posPinnedShelfKeys) {
    next.posPinnedShelfKeysUpdatedAt = patch.posPinnedShelfKeysUpdatedAt ?? now;
    next.posPinnedShelfKeyRevisions = revisionsFromPinChange(
      prev.posPinnedShelfKeys ?? [],
      patch.posPinnedShelfKeys,
      patch.posPinnedShelfKeyRevisions ?? prev.posPinnedShelfKeyRevisions,
      now,
    );
  }
  if (
    typeof patch.catalogHierarchyEnabled === "boolean" &&
    patch.catalogHierarchyEnabled !== prev.catalogHierarchyEnabled
  ) {
    next.catalogHierarchyEnabledUpdatedAt = patch.catalogHierarchyEnabledUpdatedAt ?? now;
  }
  return next;
}

export function retiredCatalogNodeIds(
  previous: readonly CatalogNode[],
  next: readonly CatalogNode[],
): string[] {
  const keep = new Set(next.map((n) => n.id));
  return previous.filter((n) => !keep.has(n.id)).map((n) => n.id);
}

export function removedLayoutKeys(
  previous: Record<string, PosShelfLayoutConfig>,
  next: Record<string, PosShelfLayoutConfig>,
): string[] {
  return Object.keys(previous).filter((key) => !(key in next));
}

function nodeToPushRow(node: CatalogNode, deletedAt?: string): Record<string, unknown> {
  return {
    id: node.id,
    parent_id: node.parentId,
    name: node.name,
    legacy_shelf_key: node.legacyShelfKey,
    sort_order: node.sortOrder,
    created_at: node.createdAt,
    updated_at: deletedAt ?? node.updatedAt,
    deleted_at: deletedAt ?? null,
  };
}

export function buildCatalogPushPayload(prefs: ShopPreferences): Record<string, unknown> {
  const doc = catalogDocumentFromPreferences(prefs);
  const liveIds = new Set(doc.nodes.map((n) => n.id));
  const nodes = [
    ...doc.nodes.map((n) => nodeToPushRow(n)),
    ...doc.tombstones.filter((t) => !liveIds.has(t.id)).map((t) =>
      nodeToPushRow(
        {
          id: t.id,
          shopId: prefs.wakaShopId ?? "local",
          parentId: null,
          name: t.id,
          legacyShelfKey: t.id,
          sortOrder: 0,
          createdAt: t.deletedAt,
          updatedAt: t.deletedAt,
        },
        t.deletedAt,
      ),
    ),
  ];
  const layout = [
    ...Object.entries(doc.layout).map(([shelf_key, config]) => ({
      shelf_key,
      config,
      updated_at: config.updatedAt ?? EPOCH,
      deleted_at: null,
    })),
    ...doc.layoutTombstones.map((t) => ({
      shelf_key: t.shelfKey,
      config: {},
      updated_at: t.deletedAt,
      deleted_at: t.deletedAt,
    })),
  ];
  return {
    nodes,
    layout,
    pinned_revisions: doc.pinnedRevisions,
    pinned_keys: doc.pinnedKeys,
    pinned_updated_at: doc.pinnedKeysUpdatedAt,
    catalog_hierarchy_enabled: doc.catalogHierarchyEnabled,
    hierarchy_updated_at: doc.catalogHierarchyEnabledUpdatedAt,
  };
}

export function parseCatalogPullPayload(raw: unknown): CatalogCloudDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.ok === false) return null;
  const meta = (o.meta && typeof o.meta === "object" ? o.meta : {}) as Record<string, unknown>;
  const nodesRaw = Array.isArray(o.nodes) ? o.nodes : [];
  const live: CatalogNode[] = [];
  const tombstones: CatalogNodeTombstone[] = [];
  for (const row of nodesRaw) {
    if (!row || typeof row !== "object") continue;
    const n = row as Record<string, unknown>;
    const id = String(n.id ?? "").trim();
    if (!id) continue;
    const deletedAt = n.deleted_at != null && String(n.deleted_at).trim() ? String(n.deleted_at) : "";
    if (deletedAt) {
      tombstones.push({ id, deletedAt });
      continue;
    }
    live.push({
      id,
      shopId: String(n.shop_id ?? "").trim() || "local",
      parentId: n.parent_id == null || String(n.parent_id).trim() === "" ? null : String(n.parent_id),
      name: String(n.name ?? id),
      legacyShelfKey: String(n.legacy_shelf_key ?? n.name ?? id),
      sortOrder: Number.isFinite(Number(n.sort_order)) ? Math.max(0, Math.floor(Number(n.sort_order))) : 0,
      createdAt: String(n.created_at ?? n.updated_at ?? new Date().toISOString()),
      updatedAt: String(n.updated_at ?? n.created_at ?? new Date().toISOString()),
    });
  }
  const layout: Record<string, PosShelfLayoutConfig> = {};
  const layoutTombstones: CatalogLayoutTombstone[] = [];
  const layoutRaw = Array.isArray(o.layout) ? o.layout : [];
  for (const row of layoutRaw) {
    if (!row || typeof row !== "object") continue;
    const l = row as Record<string, unknown>;
    const shelfKey = String(l.shelf_key ?? "").trim();
    if (!shelfKey) continue;
    const deletedAt = l.deleted_at != null && String(l.deleted_at).trim() ? String(l.deleted_at) : "";
    if (deletedAt) {
      layoutTombstones.push({ shelfKey, deletedAt });
      continue;
    }
    const config = normalizePosShelfLayout({
      [shelfKey]: {
        ...((l.config && typeof l.config === "object" ? l.config : {}) as PosShelfLayoutConfig),
        updatedAt: String(l.updated_at ?? ""),
      },
    })[shelfKey];
    if (config) layout[shelfKey] = { ...config, updatedAt: String(l.updated_at ?? config.updatedAt ?? EPOCH) };
  }
  const pinnedRevisions =
    meta.pinned_revisions && typeof meta.pinned_revisions === "object"
      ? (meta.pinned_revisions as Record<string, PinnedShelfKeyRevision>)
      : {};
  const pinnedKeys = Array.isArray(meta.pinned_keys)
    ? (meta.pinned_keys as unknown[]).map((k) => String(k).trim()).filter(Boolean)
    : [];
  return {
    nodes: live,
    tombstones,
    layout,
    layoutTombstones,
    pinnedKeys,
    pinnedKeysUpdatedAt: String(meta.pinned_updated_at ?? EPOCH),
    pinnedRevisions,
    catalogHierarchyEnabled: meta.catalog_hierarchy_enabled === true,
    catalogHierarchyEnabledUpdatedAt: String(meta.hierarchy_updated_at ?? EPOCH),
  };
}

function isMissingRpcError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "42883" || code === "PGRST202" || code === "42P01";
}

export async function pushCatalogToCloud(
  payload: Record<string, unknown>,
  ctx: { shopId: string },
): Promise<CatalogPushResult> {
  if (!supabase) return { ok: false, rejectedNodeIds: [] };
  const { data, error } = await supabase.rpc("shop_push_catalog", {
    p_shop_id: ctx.shopId,
    p_payload: payload,
  });
  if (error) {
    if (isMissingRpcError(error)) return { ok: false, rejectedNodeIds: [] };
    return { ok: false, rejectedNodeIds: [] };
  }
  const result = data as { ok?: boolean; rejected_node_ids?: unknown } | null;
  const rejected = Array.isArray(result?.rejected_node_ids)
    ? result.rejected_node_ids.map((id) => String(id).trim()).filter(Boolean)
    : [];
  return { ok: result?.ok === true, rejectedNodeIds: rejected };
}

export async function pullCatalogFromRpc(
  ctx: { shopId: string },
  since: string | null,
): Promise<{ document: CatalogCloudDocument | null; bytes: number; checkpointAt: string }> {
  const fallback = since ?? EPOCH;
  if (!supabase) {
    return { document: null, bytes: 0, checkpointAt: fallback };
  }
  const { data, error } = await supabase.rpc("shop_pull_catalog", {
    p_shop_id: ctx.shopId,
    p_since: since,
  });
  if (error) {
    if (isMissingRpcError(error)) {
      return { document: null, bytes: 0, checkpointAt: fallback };
    }
    throw error;
  }
  const result = data as { ok?: boolean; checkpoint_at?: string } | null;
  if (result?.ok === false) {
    throw new Error(String((data as { error?: string })?.error ?? "catalog_pull_forbidden"));
  }
  const bytes = JSON.stringify(data ?? {}).length;
  const document = parseCatalogPullPayload(data);
  const checkpointAt = String(result?.checkpoint_at ?? fallback);
  return { document, bytes, checkpointAt };
}

export async function processCatalogSyncOperation(ctx: { shopId: string }): Promise<boolean> {
  const { usePosStore } = await import("../store/usePosStore");
  const prefs = usePosStore.getState().preferences;
  const result = await pushCatalogToCloud(buildCatalogPushPayload(prefs), ctx);
  if (!result.ok) return false;
  if (result.rejectedNodeIds.length > 0) {
    const now = new Date().toISOString();
    const state = usePosStore.getState();
    const rejected = new Set(result.rejectedNodeIds);
    const tombstones = appendCatalogTombstones(state.preferences.posCatalogTombstones, result.rejectedNodeIds, now);
    usePosStore.setState({
      preferences: {
        ...state.preferences,
        posCatalogNodes: (state.preferences.posCatalogNodes ?? []).filter((n) => !rejected.has(n.id)),
        posCatalogTombstones: tombstones,
      },
    });
    const { reportSyncIssue } = await import("./monitoring");
    reportSyncIssue("catalog_sync_conflict_deleted", { ids: result.rejectedNodeIds });
  }
  const { scheduleImmediatePull } = await import("./immediateSync");
  scheduleImmediatePull("catalog_change");
  return true;
}
