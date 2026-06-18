import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { usePosStore } from "../store/usePosStore";
import { canSeeFinanceDiagnostics } from "../lib/financeVisibility";
import { buildSubscriptionDiagnostics } from "../lib/subscriptionDiagnostics";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-stone-100 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs font-bold uppercase tracking-wide text-stone-500">{label}</span>
      <span className="text-sm font-semibold text-stone-900">{value}</span>
    </div>
  );
}

export function SettingsSubscriptionDiagnosticsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const products = usePosStore((s) => s.products);
  const staffAccounts = usePosStore((s) => s.preferences.staffAccounts ?? []);

  if (!canSeeFinanceDiagnostics(actor.role)) {
    return <Navigate to="/settings" replace />;
  }

  const diag = buildSubscriptionDiagnostics({
    role: actor.role,
    snapshot,
    authMode,
    products,
    staffAccounts,
  });

  const productCap =
    diag.productLimit === null ? t(lang, "subscriptionDiagUnlimited") : String(diag.productLimit);
  const staffCap = diag.staffLimit <= 0 ? t(lang, "subscriptionDiagNone") : String(diag.staffLimit);

  return (
    <div className="space-y-6 pb-8">
      <PageBackBar lang={lang} fallbackTo="/settings" label={t(lang, "settingsHubTitle")} />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "subscriptionDiagTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "subscriptionDiagSub")}</p>
      </div>

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <Row label={t(lang, "subscriptionDiagRole")} value={diag.role} />
        <Row label={t(lang, "subscriptionDiagAuthMode")} value={diag.authMode} />
        <Row label={t(lang, "subscriptionDiagSnapshotKind")} value={diag.snapshotKind} />
        <Row
          label={t(lang, "subscriptionDiagBasePlan")}
          value={diag.basePlanCode ?? t(lang, "subscriptionDiagNotApplicable")}
        />
        <Row
          label={t(lang, "subscriptionDiagStatus")}
          value={diag.subscriptionStatus ?? t(lang, "subscriptionDiagNotApplicable")}
        />
        <Row label={t(lang, "subscriptionDiagEffectiveTier")} value={diag.effectiveTier} />
        <Row
          label={t(lang, "subscriptionDiagTrial")}
          value={diag.isTrialLike ? t(lang, "subscriptionDiagYes") : t(lang, "subscriptionDiagNo")}
        />
        <Row
          label={t(lang, "subscriptionDiagTrialEnds")}
          value={diag.trialEndsAt ?? t(lang, "subscriptionDiagNotApplicable")}
        />
        <Row
          label={t(lang, "subscriptionDiagPeriodEnd")}
          value={diag.currentPeriodEnd ?? t(lang, "subscriptionDiagNotApplicable")}
        />
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <Row
          label={t(lang, "subscriptionDiagProducts")}
          value={`${diag.productCount} / ${productCap}`}
        />
        <Row label={t(lang, "subscriptionDiagLockedProducts")} value={String(diag.lockedProductCount)} />
        <Row label={t(lang, "subscriptionDiagStaff")} value={`${diag.staffCount} / ${staffCap}`} />
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
          {t(lang, "subscriptionDiagBlockedFeatures")}
        </p>
        {diag.blockedFeatures.length === 0 ? (
          <p className="mt-2 text-sm font-medium text-emerald-800">{t(lang, "subscriptionDiagNoneBlocked")}</p>
        ) : (
          <ul className="mt-2 list-inside list-disc text-sm font-semibold text-stone-800">
            {diag.blockedFeatures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
