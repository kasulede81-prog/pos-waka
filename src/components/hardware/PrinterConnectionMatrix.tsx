import type { HardwareTransportCapabilities, TransportSlot } from "../../services/hardware/hardwareTransport";
import { CLASSIC_CHOOSER_HINT } from "../../lib/webBluetoothPrinter";

function badge(slot: TransportSlot): { label: string; className: string } {
  if (slot.transportReady) {
    return { label: "Available", className: "bg-emerald-600 text-white" };
  }
  if (slot.available) {
    return { label: "API present", className: "bg-sky-200 text-sky-950" };
  }
  return { label: "Not available", className: "bg-slate-200 text-slate-700" };
}

function Row({
  label,
  slot,
  extra,
}: {
  label: string;
  slot: TransportSlot;
  extra?: string;
}) {
  const tone = badge(slot);
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-border bg-muted/70 px-3 py-2">
      <div>
        <p className="text-sm font-black text-foreground">{label}</p>
        <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">{extra ?? slot.reason}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${tone.className}`}>
        {tone.label}
      </span>
    </li>
  );
}

export function PrinterConnectionMatrix({ caps }: { caps: HardwareTransportCapabilities }) {
  const envLabel =
    caps.environment === "android-native"
      ? "Android app"
      : caps.environment === "android-browser"
        ? "Android browser"
        : caps.environment === "ios-safari"
          ? "iPhone/iPad Safari"
          : caps.environment === "ios-native"
            ? "iOS app"
            : caps.environment === "electron"
              ? "WAKA desktop"
              : caps.environment === "desktop-browser"
                ? "Desktop browser"
                : "This device";

  const browserClassic = caps.environment !== "android-native";
  const ios = caps.environment === "ios-safari" || caps.environment === "ios-native";

  return (
    <article className="rounded-3xl border-2 border-border bg-card p-5 shadow-waka-sm">
      <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Printer connection</p>
      <p className="mt-1 text-lg font-black text-foreground">{envLabel}</p>
      <ul className="mt-3 space-y-2">
        {caps.environment === "android-native" ? (
          <Row label="Bluetooth" slot={caps.bluetooth.classic} extra="Bluetooth Classic + BLE" />
        ) : ios ? (
          <Row
            label="Bluetooth"
            slot={caps.bluetooth.classic}
            extra="Direct Bluetooth thermal printing is not available in this browser. For Bluetooth Classic printers, use WAKA Android."
          />
        ) : (
          <>
            <Row
              label="Bluetooth LE"
              slot={caps.bluetooth.ble}
              extra={
                caps.bluetooth.webBluetooth
                  ? "Web Bluetooth available — compatible BLE printers only"
                  : caps.bluetooth.ble.reason
              }
            />
            <Row
              label="Bluetooth Classic"
              slot={caps.bluetooth.classic}
              extra="Not available from browser"
            />
          </>
        )}
        <Row
          label="Network"
          slot={
            caps.network.electron.transportReady
              ? caps.network.electron
              : caps.network.androidNative.transportReady
                ? caps.network.androidNative
                : caps.network.electron.supported
                  ? caps.network.electron
                  : caps.network.androidNative.supported
                    ? caps.network.androidNative
                    : caps.network.browserDirect
          }
        />
        <Row
          label="USB"
          slot={caps.usb.webUsb.available ? caps.usb.webUsb : caps.usb.native}
          extra={
            caps.usb.webUsb.available
              ? "Browser API detected. Thermal printer transport not yet supported"
              : "Thermal printer transport not yet supported"
          }
        />
      </ul>
      {browserClassic ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
          {CLASSIC_CHOOSER_HINT}
        </p>
      ) : null}
    </article>
  );
}
