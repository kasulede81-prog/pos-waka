import { edgeTestRtsp, getVisionEdgeAgentInfo } from "./edgeClient";
import { parseManualRtspUrl } from "./manualRtsp";
import type { VisionCamera, VisionCameraTestResult } from "./types";
import { vaultGetSecret } from "./credentialVault";

function localFormatOnlyTest(rtspUrl: string): VisionCameraTestResult {
  const parsed = parseManualRtspUrl(rtspUrl);
  const testedAt = new Date().toISOString();
  if (!parsed.ok) {
    return {
      cameraId: null,
      testedAt,
      online: false,
      resolution: null,
      fps: null,
      latencyMs: null,
      signal: "unknown",
      recordingDetected: null,
      onvifSupported: null,
      rtspWorking: false,
      snapshotWorking: null,
      message: "Invalid RTSP URL",
      viaEdgeAgent: false,
    };
  }
  return {
    cameraId: null,
    testedAt,
    online: false,
    resolution: null,
    fps: null,
    latencyMs: null,
    signal: "unknown",
    recordingDetected: null,
    onvifSupported: null,
    rtspWorking: null,
    snapshotWorking: null,
    message:
      "RTSP URL format is valid. Start Vision Edge Agent for live Online / FPS / latency / snapshot checks.",
    viaEdgeAgent: false,
  };
}

export async function testVisionRtspTarget(input: {
  rtspUrl: string;
  username?: string;
  password?: string;
  onvifXAddr?: string | null;
}): Promise<VisionCameraTestResult> {
  const agent = await getVisionEdgeAgentInfo();
  if (!agent.available) return localFormatOnlyTest(input.rtspUrl);

  const r = await edgeTestRtsp(input);
  if (!r.ok) {
    return {
      ...localFormatOnlyTest(input.rtspUrl),
      message: r.error,
      viaEdgeAgent: true,
      online: false,
      rtspWorking: false,
    };
  }
  return r.result;
}

export async function testSavedVisionCamera(
  shopScopeId: string,
  camera: VisionCamera,
): Promise<VisionCameraTestResult> {
  const rtspUrl = camera.streamPreference === "sub" ? camera.rtspUrlSub ?? camera.rtspUrlMain : camera.rtspUrlMain;
  if (!rtspUrl) {
    return {
      cameraId: camera.id,
      testedAt: new Date().toISOString(),
      online: false,
      resolution: null,
      fps: null,
      latencyMs: null,
      signal: "unknown",
      recordingDetected: null,
      onvifSupported: camera.onvifSupported,
      rtspWorking: false,
      snapshotWorking: null,
      message: "No RTSP URL configured",
      viaEdgeAgent: false,
    };
  }
  const password =
    camera.credential?.vaultKey != null
      ? ((await vaultGetSecret(shopScopeId, camera.credential.vaultKey)) ?? undefined)
      : undefined;
  const result = await testVisionRtspTarget({
    rtspUrl,
    username: camera.credential?.username,
    password,
    onvifXAddr: camera.onvifXAddr,
  });
  return { ...result, cameraId: camera.id };
}
