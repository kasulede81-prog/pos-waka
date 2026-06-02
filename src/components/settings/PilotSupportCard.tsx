import { useEffect, useState } from "react";
import { ChevronDown, ClipboardCopy, Download, LifeBuoy } from "lucide-react";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import { useSessionActor } from "../../context/SessionActorContext";
import { useSubscription } from "../../context/SubscriptionContext";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { resolveEffectivePlanTier } from "../../lib/subscriptionEntitlements";
import { fetchShopMemberRoleForUser } from "../../lib/shopMemberRole";
import { resolvePrimaryOrganizationForUser } from "../../lib/fetchShopSubscription";
import { usePosStore } from "../../store/usePosStore";
import type { UserRole } from "../../types";
import { buildPilotDiagnosticsExport, type PilotDiagnosticsExport } from "../../lib/pilotDiagnostics";
import { countSalesWithSyncErrors, listSalesWithSyncErrors } from "../../offline/cloudSync";

type Props = { lang: Language; userId?: string | null; pilotModeEnabled?: boolean };

export function PilotSupportCard({ lang, userId, pilotModeEnabled = false }: Props) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const sync = useSyncStatus();
  const preferences = usePosStore((s) => s.preferences);
  const [shopId, setShopId] = useState<string | null>(null);
  const [cloudRole, setCloudRole] = useState<UserRole | null>(null);
  const [copied, setCopied] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PilotDiagnosticsExport | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!userId) {
      setShopId(null);
      setCloudRole(null);
      return;
    }
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
  const syncErrorCount = countSalesWithSyncErrors();
  const syncErrors = listSalesWithSyncErrors(8);

  useEffect(() => {
    let cancelled = false;
    void buildPilotDiagnosticsExport({
      authMode,
      plan: tier,
      shopId,
      cloudRole,
      effectiveRole: actor.role,
      businessType: preferences.businessType,
      syncHealth: sync.health,
      pendingCount: sync.pendingCount,
      pendingBreakdown: sync.pendingBreakdown,
      pilotModeEnabled,
    }).then((d) => {
      if (!cancelled) setDiagnostics(d);
    });
    return () => {
      cancelled = true;
    };
  }, [
    authMode,
    tier,
    shopId,
    cloudRole,
    actor.role,
    preferences.businessType,
    sync.health,
    sync.pendingCount,
    sync.pendingBreakdown,
    pilotModeEnabled,
  ]);

  const copyDiagnostics = async () => {
    if (!diagnostics) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t(lang, "pilotSupportCopy"), JSON.stringify(diagnostics, null, 2));
    }
  };

  const downloadDiagnostics = () => {
    if (!diagnostics) return;
    const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waka-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <article className="rounded-2xl border border-teal-200/90 bg-gradient-to-br from-teal-50/80 to-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-800">
          <LifeBuoy className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-black text-stone-900">{t(lang, "pilotSupportTitle")}</p>
          <p className="mt-1 text-sm text-stone-600">{t(lang, "pilotSupportSub")}</p>
        </div>
      </div>

      <details
        className="mt-4 rounded-xl border border-teal-100 bg-white/80"
        open={expanded}
        onToggle={(e) => setExpanded((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-black text-teal-900">
          <span>{t(lang, expanded ? "hideExtraFields" : "showExtraFields")}</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
        </summary>
        <div className="border-t border-teal-100 px-3 py-3">
          <dl className="grid gap-2 text-sm">
            <Row label={t(lang, "pilotSupportAppVersion")} value={diagnostics?.appVersion ?? "—"} />
            <Row label={t(lang, "pilotSupportRole")} value={actor.role} />
            <Row label={t(lang, "pilotSupportShopRole")} value={cloudRole ?? "—"} />
            <Row label={t(lang, "pilotSupportPlan")} value={tier} />
            <Row label={t(lang, "pilotSupportShopId")} value={shopId ?? "—"} mono />
            <Row label={t(lang, "pilotSupportDeviceId")} value={diagnostics?.deviceId ?? "—"} mono />
            <Row label={t(lang, "backupSyncPendingLabel")} value={String(sync.pendingCount)} />
            <Row label={t(lang, "syncFailedCount")} value={String(syncErrorCount)} />
            {sync.health.lastSuccessAt ? (
              <Row label={t(lang, "syncLastSuccess")} value={new Date(sync.health.lastSuccessAt).toLocaleString()} />
            ) : null}
            {syncErrorCount > 0 ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
                <p className="font-bold text-rose-900">
                  {tTemplate(lang, "syncErrorCount", { count: String(syncErrorCount) })}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs font-medium text-rose-800">
                  {syncErrors.map((e) => (
                    <li key={e.id} className="truncate">
                      {e.error} · {e.id.slice(0, 8)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </dl>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void copyDiagnostics()}
              disabled={!diagnostics}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-black text-white disabled:opacity-50"
            >
              <ClipboardCopy className="h-4 w-4" aria-hidden />
              {copied ? t(lang, "pilotSupportCopied") : t(lang, "pilotSupportCopy")}
            </button>
            <button
              type="button"
              onClick={downloadDiagnostics}
              disabled={!diagnostics}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border-2 border-teal-700 bg-white px-4 text-sm font-black text-teal-900 disabled:opacity-50"
            >
              <Download className="h-4 w-4" aria-hidden />
              {t(lang, "pilotSupportExportFile")}
            </button>
          </div>
        </div>
      </details>
    </article>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2">
      <dt className="font-semibold text-stone-600">{label}</dt>
      <dd className={`max-w-[55%] truncate font-black text-stone-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
