import type { ReactNode } from "react";
import { DeviceAuthorityProvider } from "../../context/DeviceAuthorityContext";
import { useDeviceActivation } from "../../context/DeviceActivationContext";

type Props = {
  authMode: "supabase" | "local";
  children: ReactNode;
};

/** Bridges shop id from device activation into authority context. */
export function DeviceAuthorityBridge({ authMode, children }: Props) {
  const { shopId } = useDeviceActivation();
  return (
    <DeviceAuthorityProvider shopId={shopId} authMode={authMode}>
      {children}
    </DeviceAuthorityProvider>
  );
}
