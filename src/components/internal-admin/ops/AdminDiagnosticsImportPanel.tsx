import { useState } from "react";
import { Upload } from "lucide-react";
import { parsePilotDiagnosticsJson, type ParsedPilotDiagnostics } from "../../../lib/pilotDiagnosticsParse";
import { internalAdminShopHref } from "../../../lib/internalAdminPreview";
import { Link } from "react-router-dom";

type Props = {
  previewMode?: boolean;
  defaultShopId?: string | null;
};

export function AdminDiagnosticsImportPanel({ previewMode = false, defaultShopId }: Props) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedPilotDiagnostics | null>(null);

  const loadText = (raw: string) => {
    setText(raw);
    setParsed(parsePilotDiagnosticsJson(raw));
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  const shopId = parsed?.shopId ?? defaultShopId ?? null;

  return (
    <section className="rounded-2xl border border-teal-200 bg-teal-50/50 p-4">
      <h2 className="text-base font-black text-stone-900">Import pilot diagnostics</h2>
      <p className="mt-1 text-xs font-medium text-stone-600">Paste or upload owner JSON — no WhatsApp screenshots needed.</p>

      <textarea
        value={text}
        onChange={(e) => loadText(e.target.value)}
        rows={4}
        placeholder='{"appVersion":"1.0.5","shopId":"…",…}'
        className="mt-3 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 font-mono text-xs"
      />

      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-bold text-teal-900">
        <Upload className="h-4 w-4" aria-hidden />
        Upload JSON file
        <input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </label>

      {parsed && !parsed.valid ? (
        <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">{parsed.parseError}</p>
      ) : null}

      {parsed?.valid ? (
        <dl className="mt-4 grid gap-2 text-sm">
          <Row label="Exported" value={parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString("en-GB") : "—"} />
          <Row label="Shop ID" value={parsed.shopId ?? "—"} mono />
          <Row label="App version" value={parsed.appVersion} />
          <Row label="Device ID" value={parsed.deviceId} mono />
          <Row label="Plan" value={parsed.plan} />
          <Row label="Role" value={`${parsed.effectiveRole}${parsed.cloudRole ? ` / cloud ${parsed.cloudRole}` : ""}`} />
          <Row label="Business type" value={parsed.businessType} />
          <Row label="Pending queue" value={String(parsed.pendingSyncQueue)} />
          <Row label="Unsynced sales" value={String(parsed.unsyncedSales)} />
          <Row label="Sync errors" value={String(parsed.syncErrorCount)} />
          {parsed.issueNote ? <Row label="Issue note" value={parsed.issueNote} /> : null}
          {parsed.screenshotFileName ? <Row label="Screenshot" value={parsed.screenshotFileName} /> : null}
          {Object.keys(parsed.pendingBreakdown).length > 0 ? (
            <div className="rounded-xl bg-white px-3 py-2 text-xs">
              <p className="font-black text-stone-700">Queue breakdown</p>
              <ul className="mt-1 space-y-0.5 font-mono text-stone-600">
                {Object.entries(parsed.pendingBreakdown).map(([k, v]) => (
                  <li key={k}>
                    {k}: {v}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {parsed.syncErrors.length > 0 ? (
            <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-900">
              <p className="font-black">Sale sync errors</p>
              <ul className="mt-1 max-h-24 space-y-1 overflow-y-auto">
                {parsed.syncErrors.map((e) => (
                  <li key={e.id} className="truncate">
                    {e.error} · {e.id.slice(0, 8)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="rounded-xl bg-white px-3 py-2 text-xs">
            <p className="font-black text-stone-700">Migrations (client checklist)</p>
            <ul className="mt-1 list-disc pl-4 text-stone-600">
              {parsed.requiredMigrations.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            {parsed.migrationNote ? <p className="mt-1 text-stone-500">{parsed.migrationNote}</p> : null}
          </div>
          {parsed.recentEvents.length > 0 ? (
            <div className="rounded-xl bg-white px-3 py-2 text-xs">
              <p className="font-black text-stone-700">Pilot events (device)</p>
              <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-stone-600">
                {parsed.recentEvents.map((e, i) => (
                  <li key={`${e.at}-${i}`}>
                    <span className="font-bold">{e.kind}</span> · {e.summary}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {shopId ? (
            <Link
              to={internalAdminShopHref(shopId, previewMode)}
              className="mt-2 inline-flex min-h-[40px] items-center rounded-xl bg-teal-700 px-4 text-xs font-black text-white"
            >
              Open shop profile →
            </Link>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2 rounded-xl bg-white/80 px-3 py-2">
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className={`max-w-[60%] truncate text-right font-black text-stone-900 ${mono ? "font-mono text-[11px]" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
