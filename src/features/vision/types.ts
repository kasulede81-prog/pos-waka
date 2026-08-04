/**
 * WAKA Vision types — registry (V1.1) + live streaming sessions (V1.2).
 * No playback timeline / AI / POS event coupling in these phases.
 */

export type VisionCameraStatus = "online" | "degraded" | "offline" | "unconfigured" | "unknown";

export type VisionRecordingMode = "none" | "camera_sd" | "nvr" | "dvr" | "cloud" | "hybrid" | "unknown";

export type VisionStreamPreference = "main" | "sub";

/** Reserved zone taxonomy — future “show warehouse cameras” without schema break. */
export type VisionZoneId =
  | "checkout"
  | "cashier"
  | "cash_drawer"
  | "entrance"
  | "exit"
  | "store_floor"
  | "dispensary"
  | "safe"
  | "kitchen"
  | "bar"
  | "dining"
  | "warehouse"
  | "stockroom"
  | "back_door"
  | "parking"
  | "other";

export type VisionCameraProfileId =
  | "cashier"
  | "entrance"
  | "store"
  | "back_door"
  | "counter"
  | "dispensary"
  | "safe"
  | "kitchen"
  | "bar"
  | "dining"
  | "warehouse"
  | "custom";

export type VisionCameraCredentialRef = {
  id: string;
  /** Username kept alongside vault ciphertext id (not secret). */
  username: string;
  vaultKey: string;
  keyVersion: number;
};

export type VisionCamera = {
  id: string;
  shopScopeId: string;
  organizationId?: string | null;
  branchId?: string | null;
  branchLabel?: string | null;
  name: string;
  locationLabel: string;
  zoneId: VisionZoneId;
  profileId: VisionCameraProfileId;
  brand: string | null;
  model: string | null;
  serial: string | null;
  ip: string | null;
  onvifPort: number | null;
  onvifXAddr: string | null;
  onvifSupported: boolean | null;
  rtspUrlMain: string | null;
  rtspUrlSub: string | null;
  streamPreference: VisionStreamPreference;
  credential: VisionCameraCredentialRef | null;
  status: VisionCameraStatus;
  recordingMode: VisionRecordingMode;
  nvrHost: string | null;
  nvrChannelId: string | null;
  assignedPosLabel: string | null;
  lastTestAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VisionDiscoveredCandidate = {
  discoveryId: string;
  name: string | null;
  ip: string;
  onvifXAddr: string | null;
  brand: string | null;
  model: string | null;
  scopes: string[];
  rtspHint: string | null;
  source: "onvif_probe" | "nvr_import" | "manual" | "demo";
};

export type VisionNvrImportChannel = {
  channelId: string;
  name: string;
  ip: string | null;
  rtspUrl: string | null;
  brand: string | null;
  model: string | null;
};

export type VisionCameraTestResult = {
  cameraId: string | null;
  testedAt: string;
  online: boolean;
  resolution: string | null;
  fps: number | null;
  latencyMs: number | null;
  signal: "good" | "fair" | "poor" | "unknown";
  recordingDetected: boolean | null;
  onvifSupported: boolean | null;
  rtspWorking: boolean | null;
  snapshotWorking: boolean | null;
  message: string | null;
  viaEdgeAgent: boolean;
};

export type VisionRegistrySnapshot = {
  version: 1;
  shopScopeId: string;
  cameras: VisionCamera[];
  updatedAt: string;
};

export type VisionEdgeAgentInfo = {
  available: boolean;
  version: string | null;
  baseUrl: string;
  message: string | null;
  mediamtxAvailable?: boolean;
};

export type VisionLiveHealthStatus = "healthy" | "warning" | "offline" | "reconnecting";

export type VisionStreamPlayback = {
  webrtcUrl: string | null;
  hlsUrl: string | null;
  preferred: "webrtc" | "hls" | "demo";
};

export type VisionStreamSession = {
  sessionId: string;
  cameraId: string | null;
  mode: "live" | "demo";
  createdAt: string;
  health: {
    status: VisionLiveHealthStatus;
    latencyMs: number | null;
    resolution: string | null;
    fps: number | null;
    codec: string | null;
    recordingSource: string | null;
    lastSeenAt: string | null;
    message: string | null;
  };
  playback: VisionStreamPlayback;
};

export type VisionGridSize = 1 | 2 | 4 | 9 | 16;
