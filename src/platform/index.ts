export type { WakaPlatform, WakaCapabilities, WakaCapabilityName } from "./types";
export {
  getPlatform,
  hasWakaDesktopBridge,
  isWebPlatform,
  isMobilePlatform,
  isDesktopPlatform,
} from "./detect";
export {
  getCapabilities,
  hasCapability,
  canNativePrint,
  canRemoteSupportNative,
  canEscPosNetwork,
} from "./capabilities";
