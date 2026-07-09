import { useEffect, useState } from "react";
import { actorHasPermission } from "../../lib/actorAuthorization";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSessionActor } from "../../context/SessionActorContext";

import {
  buildDeletionSafetyDiagnosticSnapshot,
  type DeletionSafetyDiagnosticSnapshot,
} from "../../lib/deletionSafetyDiagnostics";
import { ORGANIZATION_DELETED_MESSAGE } from "../../lib/organizationDeletionState";

const RISK_KEYS: Record<string, "deletionSafetyRiskLocalNamespaces" | "deletionSafetyRiskLocalBackups" | "deletionSafetyRiskDeletedOrgLocal" | "deletionSafetyRiskNoTombstones"> = {
  local_namespaces_present: "deletionSafetyRiskLocalNamespaces",
  local_backups_present: "deletionSafetyRiskLocalBackups",
  deleted_org_with_local_data: "deletionSafetyRiskDeletedOrgLocal",
  no_product_tombstones_tracked: "deletionSafetyRiskNoTombstones",
};

export function DeletionSafetyDiagnosticsCard({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const [snap, setSnap] = useState<DeletionSafetyDiagnosticSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void buildDeletionSafetyDiagnosticSnapshot().then((next) => {
      if (!cancelled) setSnap(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!actor || !actorHasPermission(actor, "owner.dashboard")) return null;

  const risks = snap?.resurrectionRisks ?? [];
  const blocked = snap?.organizationBlocked ?? false;

  return (
    <article className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <p className="text-base font-black text-stone-900">{t(lang, "deletionSafetyDiagnosticsTitle")}</p>
      <p className="mt-1 text-sm text-stone-600">{t(lang, "deletionSafetyDiagnosticsSub")}</p>

      {blocked && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-950">
          {ORGANIZATION_DELETED_MESSAGE}
        </p>
      )}

      <dl className="mt-3 space-y-2 text-sm text-stone-700">
        <div className="flex justify-between gap-3">
          <dt>{t(lang, "deletionSafetyActiveNamespace")}</dt>
          <dd className="font-mono text-xs">{snap?.activeAccountKey ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t(lang, "deletionSafetyNamespaceCount")}</dt>
          <dd className="font-semibold">{snap?.namespaces.length ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t(lang, "deletionSafetyBackupCount")}</dt>
          <dd className="font-semibold">
            {snap?.namespaces.reduce((sum, n) => sum + n.backupCount, 0) ?? "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t(lang, "deletionSafetyTombstones")}</dt>
          <dd className="font-semibold">
            {snap != null ? `${snap.tombstoneProductCount} / ${snap.tombstoneSaleCount}` : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t(lang, "deletionSafetyDeletionMarker")}</dt>
          <dd className="font-semibold">{snap?.deletionMarker?.status ?? t(lang, "deletionSafetyNone")}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t(lang, "deletionSafetyWipeMarker")}</dt>
          <dd className="font-semibold">
            {snap?.wipeMarker ? t(lang, "deletionSafetyPresent") : t(lang, "deletionSafetyNone")}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t(lang, "deletionSafetyWipeReady")}</dt>
          <dd className="font-semibold">
            {snap?.wipeReady ? t(lang, "deletionSafetyYes") : t(lang, "deletionSafetyNo")}
          </dd>
        </div>
      </dl>

      {risks.length === 0 ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950">
          {t(lang, "deletionSafetyAllClear")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {risks.map((risk) => {
            const key = RISK_KEYS[risk];
            return (
              <li
                key={risk}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950"
              >
                {key ? t(lang, key) : risk}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
