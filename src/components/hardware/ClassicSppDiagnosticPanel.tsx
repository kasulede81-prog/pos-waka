import type { NativeClassicDiagnostic } from "../../lib/nativeBluetoothPrinter";
import { parseBluetoothDeviceId } from "../../lib/bluetoothPrinterHeuristics";

function flag(ok: boolean | undefined): string {
  return ok ? "SUCCESS" : "FAILED";
}

export function ClassicSppDiagnosticPanel({ diagnostic }: { diagnostic: NativeClassicDiagnostic }) {
  const address = diagnostic.address || parseBluetoothDeviceId(diagnostic.deviceId)?.address || "—";
  return (
    <article className="mt-3 space-y-1 rounded-2xl border-2 border-sky-200 bg-sky-50 px-3 py-3 text-xs font-semibold text-sky-950">
      <p className="text-[11px] font-black uppercase tracking-wide">Bluetooth Classic SPP</p>
      <p>Device: {diagnostic.deviceName || "Bluetooth device"}</p>
      <p>Address: {address}</p>
      <p>Transport: Android Native RFCOMM/SPP</p>
      <p>Connection: {flag(diagnostic.connectionSucceeded)}</p>
      <p>RFCOMM: {diagnostic.connectionSucceeded ? "CONNECTED" : "FAILED"}</p>
      <p>
        Bytes: {diagnostic.bytesWritten ?? 0}
        {diagnostic.bytesRequested != null ? ` / ${diagnostic.bytesRequested}` : ""}
      </p>
      <p>Write: {flag(diagnostic.writeSucceeded)}</p>
      <p>Flush: {flag(diagnostic.flushSucceeded)}</p>
      <p>Socket close: {flag(diagnostic.socketClosed)}</p>
      <p>Physical paper: TEST REQUIRED</p>
      {!diagnostic.ok && (diagnostic.errorType || diagnostic.errorMessage || diagnostic.error) ? (
        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-2 py-2 text-red-900">
          <p className="font-black">RFCOMM {diagnostic.stage ? `${diagnostic.stage} ` : ""}failed</p>
          {diagnostic.errorType ? <p>{diagnostic.errorType}</p> : null}
          <p>{diagnostic.errorMessage || diagnostic.error}</p>
        </div>
      ) : (
        <p className="mt-2 font-black">Data sent to printer</p>
      )}
    </article>
  );
}
