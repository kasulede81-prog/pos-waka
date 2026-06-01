import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Download, LifeBuoy, MessageCircle, Mail, Camera } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PageHeader } from "../components/layout/PageHeader";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { resolveEffectivePlanTier } from "../lib/subscriptionEntitlements";
import { fetchShopMemberRoleForUser } from "../lib/shopMemberRole";
import { resolvePrimaryOrganizationForUser } from "../lib/fetchShopSubscription";
import { usePosStore } from "../store/usePosStore";
import { buildPilotDiagnosticsExport, type PilotDiagnosticsExport } from "../lib/pilotDiagnostics";
import { readPilotEvents } from "../lib/pilotEventLog";
import { wakaSupportMailtoUrl, wakaSupportWhatsAppUrl } from "../config/wakaSupport";
import { Navigate } from "react-router-dom";
import { canTogglePilotMode } from "../lib/pilotMode";

type Props = { lang: Language };

function issueBody(diagnostics: PilotDiagnosticsExport, note: string): string {
  const lines = [
    "Waka POS pilot support report",
    `App: ${diagnostics.appVersion}`,
    `Shop: ${diagnostics.shopId ?? "unknown"}`,
    `Device: ${diagnostics.deviceId}`,
    `Plan: ${diagnostics.plan}`,
    `Sync errors: ${diagnostics.syncErrorCount}`,
    `Pending queue: ${diagnostics.pendingSyncQueue}`,
    "",
    note.trim() ? `Issue: ${note.trim()}` : "Issue: (describe above)",
    "",
    "Full diagnostics attached or pasted separately.",
  ];
  return lines.join("\n");
}

export function PilotSupportCenterPage({ lang }: Props) {
  const actor = useSessionActor();
  const { snapshot, authMode, userId } = useSubscription();
  const sync = useSyncStatus();
  const preferences = usePosStore((s) => s.preferences);
  const [shopId, setShopId] = useState<string | null>(null);
  const [cloudRole, setCloudRole] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<PilotDiagnosticsExport | null>(null);
  const [issueNote, setIssueNote] = useState("");
  const [screenshotName, setScreenshotName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sentHint, setSentHint] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const orgShop = await resolvePrimaryOrganizationForUser(userId);
      const role = await fetchShopMemberRoleForUser(userId);
      if (cancelled) return;
      setShopId(orgShop?.shopId ?? null);
      setCloudRole(role);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const tier = resolveEffectivePlanTier(snapshot);
  const events = useMemo(() => readPilotEvents(20), [diagnostics?.at]);

  useEffect(() => {
    let cancelled = false;
    void buildPilotDiagnosticsExport({
      authMode,
      plan: tier,
      shopId,
      cloudRole: cloudRole as import("../types").UserRole | null,
      effectiveRole: actor.role,
      businessType: preferences.businessType,
      syncHealth: sync.health,
      pendingCount: sync.pendingCount,
      pendingBreakdown: sync.pendingBreakdown,
      pilotModeEnabled: true,
    }).then((d) => {
      if (!cancelled) {
        setDiagnostics({ ...d, pilotEvents: events } as PilotDiagnosticsExport & { pilotEvents: typeof events });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authMode, tier, shopId, cloudRole, actor.role, preferences.businessType, sync.health, sync.pendingCount, sync.pendingBreakdown, events]);

  if (!canTogglePilotMode(actor.role)) {
    return <Navigate to="/" replace />;
  }

  const exportPayload = diagnostics
    ? {
        ...diagnostics,
        issueNote: issueNote.trim() || null,
        screenshotFileName: screenshotName,
        pilotEvents: events,
      }
    : null;

  const copyAll = async () => {
    if (!exportPayload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t(lang, "pilotSupportCopy"), JSON.stringify(exportPayload, null, 2));
    }
  };

  const downloadJson = () => {
    if (!exportPayload) return;
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waka-support-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reportViaWhatsApp = async () => {
    await copyAll();
    const text = issueBody(diagnostics!, issueNote);
    window.open(wakaSupportWhatsAppUrl(text), "_blank", "noopener,noreferrer");
    setSentHint(t(lang, "pilotSupportWhatsAppHint"));
  };

  const reportViaEmail = async () => {
    await copyAll();
    const subject = `Waka POS pilot · ${diagnostics?.shopId ?? "shop"} · v${diagnostics?.appVersion ?? ""}`;
    const body = issueBody(diagnostics!, issueNote);
    window.location.href = wakaSupportMailtoUrl(subject, body);
    setSentHint(t(lang, "pilotSupportEmailHint"));
  };

  const onScreenshot = (file: File | null) => {
    if (!file) {
      setScreenshotName(null);
      return;
    }
    setScreenshotName(file.name);
  };

  return (
    <div className="space-y-4 pb-10">
      <PageHeader lang={lang} title={t(lang, "pilotSupportCenterTitle")} backLabel={t(lang, "officeBackToHub")} />

      <article className="rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
        <div className="flex items-start gap-3">
          <LifeBuoy className="h-8 w-8 shrink-0 text-teal-800" aria-hidden />
          <div>
            <p className="text-base font-black text-stone-900">{t(lang, "pilotSupportCenterSub")}</p>
            <p className="mt-1 text-sm text-stone-600">{t(lang, "pilotSupportCenterHelp")}</p>
          </div>
        </div>
      </article>

      <label className="block rounded-2xl border border-stone-200 bg-white p-4">
        <span className="text-sm font-black text-stone-900">{t(lang, "pilotSupportIssueLabel")}</span>
        <textarea
          value={issueNote}
          onChange={(e) => setIssueNote(e.target.value)}
          rows={3}
          className="mt-2 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm"
          placeholder={t(lang, "pilotSupportIssuePlaceholder")}
        />
      </label>

      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-3">
        <Camera className="h-5 w-5 text-stone-500" aria-hidden />
        <span className="text-sm font-semibold text-stone-700">
          {screenshotName ? screenshotName : t(lang, "pilotSupportScreenshot")}
        </span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => onScreenshot(e.target.files?.[0] ?? null)}
        />
      </label>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void reportViaWhatsApp()}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#25D366] text-sm font-black text-white"
        >
          <MessageCircle className="h-5 w-5" aria-hidden />
          {t(lang, "pilotSupportReportWhatsApp")}
        </button>
        <button
          type="button"
          onClick={() => void reportViaEmail()}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border-2 border-orange-200 bg-orange-50 text-sm font-black text-orange-950"
        >
          <Mail className="h-5 w-5" aria-hidden />
          {t(lang, "pilotSupportReportEmail")}
        </button>
        <button
          type="button"
          onClick={() => void copyAll()}
          disabled={!exportPayload}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-teal-700 text-sm font-black text-white disabled:opacity-50"
        >
          <ClipboardCopy className="h-4 w-4" aria-hidden />
          {copied ? t(lang, "pilotSupportCopied") : t(lang, "pilotSupportCopy")}
        </button>
        <button
          type="button"
          onClick={downloadJson}
          disabled={!exportPayload}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border-2 border-teal-700 bg-white text-sm font-black text-teal-900 disabled:opacity-50"
        >
          <Download className="h-4 w-4" aria-hidden />
          {t(lang, "pilotSupportExportFile")}
        </button>
      </div>

      {sentHint ? <p className="text-sm font-semibold text-teal-900">{sentHint}</p> : null}

      {events.length > 0 ? (
        <section className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-sm font-black text-stone-900">{t(lang, "pilotEventLogTitle")}</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-stone-600">
            {events.map((e) => (
              <li key={e.id} className="truncate">
                <span className="font-bold text-stone-800">{e.kind}</span> · {e.summary}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
