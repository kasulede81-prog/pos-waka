import { readKv, writeKv } from "../../offline/localDb";
import { vaultDeleteSecret, vaultPutSecret } from "./credentialVault";
import { defaultZoneForProfile } from "./zones";
import type {
  VisionCamera,
  VisionCameraProfileId,
  VisionDiscoveredCandidate,
  VisionRecordingMode,
  VisionRegistrySnapshot,
  VisionStreamPreference,
  VisionZoneId,
} from "./types";

function registryKvKey(shopScopeId: string): string {
  return `vision-camera-registry::${shopScopeId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function loadVisionRegistry(shopScopeId: string): Promise<VisionCamera[]> {
  const snap = await readKv<VisionRegistrySnapshot>(registryKvKey(shopScopeId));
  if (!snap || snap.version !== 1 || !Array.isArray(snap.cameras)) return [];
  return snap.cameras;
}

async function persistRegistry(shopScopeId: string, cameras: VisionCamera[]): Promise<void> {
  const snap: VisionRegistrySnapshot = {
    version: 1,
    shopScopeId,
    cameras,
    updatedAt: nowIso(),
  };
  await writeKv(registryKvKey(shopScopeId), snap);
}

export type SaveVisionCameraInput = {
  shopScopeId: string;
  id?: string;
  name: string;
  locationLabel: string;
  zoneId?: VisionZoneId;
  profileId?: VisionCameraProfileId;
  brand?: string | null;
  model?: string | null;
  serial?: string | null;
  ip?: string | null;
  onvifPort?: number | null;
  onvifXAddr?: string | null;
  onvifSupported?: boolean | null;
  rtspUrlMain?: string | null;
  rtspUrlSub?: string | null;
  streamPreference?: VisionStreamPreference;
  username?: string;
  password?: string;
  recordingMode?: VisionRecordingMode;
  nvrHost?: string | null;
  nvrChannelId?: string | null;
  branchLabel?: string | null;
  assignedPosLabel?: string | null;
  status?: VisionCamera["status"];
};

export async function saveVisionCamera(input: SaveVisionCameraInput): Promise<VisionCamera> {
  const cameras = await loadVisionRegistry(input.shopScopeId);
  const existing = input.id ? cameras.find((c) => c.id === input.id) : undefined;
  const id = existing?.id ?? crypto.randomUUID();
  const profileId = input.profileId ?? existing?.profileId ?? "custom";
  const zoneId = input.zoneId ?? existing?.zoneId ?? defaultZoneForProfile(profileId);
  const at = nowIso();

  let credential = existing?.credential ?? null;
  const username = input.username?.trim() ?? credential?.username ?? "";
  if (input.password != null && input.password.length > 0) {
    const vaultKey = credential?.vaultKey ?? `cam:${id}`;
    await vaultPutSecret(input.shopScopeId, vaultKey, input.password);
    credential = {
      id: credential?.id ?? crypto.randomUUID(),
      username,
      vaultKey,
      keyVersion: (credential?.keyVersion ?? 0) + 1,
    };
  } else if (username && credential) {
    credential = { ...credential, username };
  } else if (username && !credential) {
    credential = {
      id: crypto.randomUUID(),
      username,
      vaultKey: `cam:${id}`,
      keyVersion: 1,
    };
  }

  const row: VisionCamera = {
    id,
    shopScopeId: input.shopScopeId,
    organizationId: existing?.organizationId ?? null,
    branchId: existing?.branchId ?? null,
    branchLabel: input.branchLabel !== undefined ? input.branchLabel : (existing?.branchLabel ?? "Main Shop"),
    name: input.name.trim(),
    locationLabel: input.locationLabel.trim(),
    zoneId,
    profileId,
    brand: input.brand !== undefined ? input.brand : (existing?.brand ?? null),
    model: input.model !== undefined ? input.model : (existing?.model ?? null),
    serial: input.serial !== undefined ? input.serial : (existing?.serial ?? null),
    ip: input.ip !== undefined ? input.ip : (existing?.ip ?? null),
    onvifPort: input.onvifPort !== undefined ? input.onvifPort : (existing?.onvifPort ?? null),
    onvifXAddr: input.onvifXAddr !== undefined ? input.onvifXAddr : (existing?.onvifXAddr ?? null),
    onvifSupported:
      input.onvifSupported !== undefined ? input.onvifSupported : (existing?.onvifSupported ?? null),
    rtspUrlMain: input.rtspUrlMain !== undefined ? input.rtspUrlMain : (existing?.rtspUrlMain ?? null),
    rtspUrlSub: input.rtspUrlSub !== undefined ? input.rtspUrlSub : (existing?.rtspUrlSub ?? null),
    streamPreference: input.streamPreference ?? existing?.streamPreference ?? "main",
    credential,
    status: input.status ?? existing?.status ?? "unconfigured",
    recordingMode: input.recordingMode ?? existing?.recordingMode ?? "unknown",
    nvrHost: input.nvrHost !== undefined ? input.nvrHost : (existing?.nvrHost ?? null),
    nvrChannelId: input.nvrChannelId !== undefined ? input.nvrChannelId : (existing?.nvrChannelId ?? null),
    assignedPosLabel:
      input.assignedPosLabel !== undefined ? input.assignedPosLabel : (existing?.assignedPosLabel ?? null),
    lastTestAt: existing?.lastTestAt ?? null,
    lastSeenAt: existing?.lastSeenAt ?? null,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };

  const next = existing ? cameras.map((c) => (c.id === id ? row : c)) : [row, ...cameras];
  await persistRegistry(input.shopScopeId, next);
  return row;
}

export async function saveVisionCameraFromDiscovery(input: {
  shopScopeId: string;
  candidate: VisionDiscoveredCandidate;
  name: string;
  locationLabel: string;
  zoneId?: VisionZoneId;
  profileId?: VisionCameraProfileId;
  username?: string;
  password?: string;
  recordingMode?: VisionRecordingMode;
  assignedPosLabel?: string | null;
  branchLabel?: string | null;
  nvrHost?: string | null;
  nvrChannelId?: string | null;
}): Promise<VisionCamera> {
  const channelId =
    input.nvrChannelId ??
    (input.candidate.source === "nvr_import" ? input.candidate.discoveryId.split(":").pop() ?? null : null);
  return saveVisionCamera({
    shopScopeId: input.shopScopeId,
    name: input.name,
    locationLabel: input.locationLabel,
    zoneId: input.zoneId,
    profileId: input.profileId,
    brand: input.candidate.brand,
    model: input.candidate.model,
    ip: input.candidate.ip,
    onvifXAddr: input.candidate.onvifXAddr,
    onvifSupported: Boolean(input.candidate.onvifXAddr) || input.candidate.scopes.length > 0,
    rtspUrlMain: input.candidate.rtspHint,
    username: input.username,
    password: input.password,
    recordingMode: input.recordingMode ?? "nvr",
    assignedPosLabel: input.assignedPosLabel ?? null,
    branchLabel: input.branchLabel,
    nvrHost: input.nvrHost ?? (input.candidate.source === "nvr_import" ? input.candidate.ip : null),
    nvrChannelId: channelId,
    status: "unknown",
  });
}

/** Import many discovery candidates with shared assignment defaults (V1.3 installer). */
export async function saveVisionCamerasFromDiscoveryBulk(input: {
  shopScopeId: string;
  candidates: VisionDiscoveredCandidate[];
  zoneId?: VisionZoneId;
  profileId?: VisionCameraProfileId;
  username?: string;
  password?: string;
  recordingMode?: VisionRecordingMode;
  assignedPosLabel?: string | null;
  branchLabel?: string | null;
  nvrHost?: string | null;
  namePrefix?: string;
}): Promise<VisionCamera[]> {
  const saved: VisionCamera[] = [];
  for (let i = 0; i < input.candidates.length; i += 1) {
    const candidate = input.candidates[i]!;
    const row = await saveVisionCameraFromDiscovery({
      shopScopeId: input.shopScopeId,
      candidate,
      name: candidate.name || `${input.namePrefix ?? "Camera"} ${i + 1}`,
      locationLabel: candidate.name || candidate.ip,
      zoneId: input.zoneId,
      profileId: input.profileId,
      username: input.username,
      password: input.password,
      recordingMode: input.recordingMode,
      assignedPosLabel: input.assignedPosLabel,
      branchLabel: input.branchLabel,
      nvrHost: input.nvrHost,
    });
    saved.push(row);
  }
  return saved;
}

export async function deleteVisionCamera(shopScopeId: string, cameraId: string): Promise<void> {
  const cameras = await loadVisionRegistry(shopScopeId);
  const target = cameras.find((c) => c.id === cameraId);
  if (!target) return;
  if (target.credential?.vaultKey) {
    await vaultDeleteSecret(shopScopeId, target.credential.vaultKey);
  }
  await persistRegistry(
    shopScopeId,
    cameras.filter((c) => c.id !== cameraId),
  );
}

export async function updateVisionCameraTestMeta(
  shopScopeId: string,
  cameraId: string,
  patch: Pick<VisionCamera, "status" | "lastTestAt" | "lastSeenAt" | "onvifSupported">,
): Promise<void> {
  const cameras = await loadVisionRegistry(shopScopeId);
  const next = cameras.map((c) =>
    c.id === cameraId
      ? {
          ...c,
          ...patch,
          updatedAt: nowIso(),
        }
      : c,
  );
  await persistRegistry(shopScopeId, next);
}
