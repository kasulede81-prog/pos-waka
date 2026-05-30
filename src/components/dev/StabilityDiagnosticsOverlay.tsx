import { useEffect, useState } from "react";
import { usePosStore } from "../../store/usePosStore";
import {
  getLastMergeMs,
  getPersistStats,
  networkRequestsLastMinute,
  readJsHeapMb,
} from "../../lib/stabilityDiagnostics";

export function StabilityDiagnosticsOverlay() {
  const [tick, setTick] = useState(0);
  const salesLen = usePosStore((s) => s.sales.length);
  const productsLen = usePosStore((s) => s.products.length);
  const customersLen = usePosStore((s) => s.customers.length);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 2000);
    return () => window.clearInterval(id);
  }, []);

  const heap = readJsHeapMb();
  const persist = getPersistStats();
  const mergeMs = getLastMergeMs();
  const netMin = networkRequestsLastMinute();

  return (
    <div
      className="pointer-events-none fixed bottom-2 left-2 z-[9999] max-w-[min(100vw-1rem,22rem)] rounded-xl border border-stone-700/80 bg-stone-950/90 px-3 py-2 font-mono text-[10px] leading-relaxed text-emerald-300 shadow-lg backdrop-blur-sm"
      aria-hidden
    >
      <p className="font-bold text-amber-300">Waka stability diag</p>
      <p>Realtime subs: 0</p>
      <p>
        Network/min: {netMin} · Heap: {heap != null ? `${heap} MB` : "n/a"}
      </p>
      <p>
        Sales: {salesLen} · Products: {productsLen} · Customers: {customersLen}
      </p>
      <p>
        IDB persists: {persist.total}
        {persist.lastAt ? ` · last ${Math.round((Date.now() - persist.lastAt) / 1000)}s ago` : ""}
      </p>
      <p>Last cloud merge: {mergeMs != null ? `${mergeMs} ms` : "—"}</p>
      <p className="text-stone-500">tick {tick}</p>
    </div>
  );
}
