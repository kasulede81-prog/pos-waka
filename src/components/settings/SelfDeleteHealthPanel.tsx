import { useEffect, useState } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { useSessionActor } from "../../context/SessionActorContext";
import { buildSelfDeleteHealthSnapshot, type SelfDeleteHealthSnapshot } from "../../lib/selfDeleteHealth";
import type { User } from "@supabase/supabase-js";
import { hasRecentOwnerDeleteReauth } from "../../lib/ownerDeleteReauth";

function statusLabel(lang: Language, status: SelfDeleteHealthSnapshot["rpcStatus"]): string {
  if (status === "ok") return t(lang, "selfDeleteHealthOk");
  if (status === "fail") return t(lang, "selfDeleteHealthFail");
  if (status === "skipped") return t(lang, "selfDeleteHealthSkipped");
  return t(lang, "selfDeleteHealthUnknown");
}

function statusClass(status: SelfDeleteHealthSnapshot["rpcStatus"]): string {
  if (status === "ok") return "text-emerald-700";
  if (status === "fail") return "text-rose-700";
  return "text-stone-600";
}

type Props = {
  lang: Language;
  user: User | null;
};

export function SelfDeleteHealthPanel({ lang, user }: Props) {
  const actor = useSessionActor();
  const [snap, setSnap] = useState<SelfDeleteHealthSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      const next = await buildSelfDeleteHealthSnapshot({
        isOwner: actor.role === "owner",
        user,
      });
      setSnap(next);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [actor.role, user?.id]);

  if (actor.role !== "owner") return null;

  return (
    <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-waka-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-stone-950">{t(lang, "selfDeleteHealthTitle")}</h2>
          <p className="mt-1 text-sm font-medium text-stone-500">{t(lang, "selfDeleteHealthSub")}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="rounded-xl border border-stone-200 px-3 py-2 text-xs font-bold text-stone-700 disabled:opacity-50"
        >
          {busy ? t(lang, "selfDeleteHealthChecking") : t(lang, "selfDeleteHealthRefresh")}
        </button>
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="font-bold text-stone-600">{t(lang, "selfDeleteHealthRoute")}</dt>
          <dd className={`font-semibold ${snap?.routeAccessOk ? "text-emerald-700" : "text-rose-700"}`}>
            {snap?.routeAccessOk ? t(lang, "selfDeleteHealthOk") : t(lang, "selfDeleteHealthFail")}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="font-bold text-stone-600">{t(lang, "selfDeleteHealthRpc")}</dt>
          <dd className={`font-semibold ${statusClass(snap?.rpcStatus ?? "unknown")}`}>
            {statusLabel(lang, snap?.rpcStatus ?? "unknown")}
          </dd>
        </div>
        {snap?.rpcDetail ? (
          <dd className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
            {snap.rpcDetail}
          </dd>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="font-bold text-stone-600">{t(lang, "selfDeleteHealthEdge")}</dt>
          <dd className={`font-semibold ${statusClass(snap?.edgeStatus ?? "unknown")}`}>
            {statusLabel(lang, snap?.edgeStatus ?? "unknown")}
          </dd>
        </div>
        {snap?.edgeDetail ? (
          <dd className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
            {snap.edgeDetail}
          </dd>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="font-bold text-stone-600">{t(lang, "selfDeleteHealthReauth")}</dt>
          <dd className={`font-semibold ${hasRecentOwnerDeleteReauth() || snap?.reauthRecent ? "text-emerald-700" : "text-amber-700"}`}>
            {hasRecentOwnerDeleteReauth() || snap?.reauthRecent
              ? t(lang, "selfDeleteHealthReauthRecent")
              : t(lang, "selfDeleteHealthReauthNeeded")}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <dt className="font-bold text-stone-600">{t(lang, "selfDeleteHealthDevices")}</dt>
          <dd className={`font-semibold ${snap?.deviceCleanupReady ? "text-emerald-700" : "text-stone-600"}`}>
            {snap?.deviceCleanupReady ? t(lang, "selfDeleteHealthReady") : t(lang, "selfDeleteHealthNotReady")}
          </dd>
        </div>
        {snap?.orphanAuth ? (
          <dd className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
            {t(lang, "selfDeleteHealthOrphanAuth")}
          </dd>
        ) : null}
      </dl>
    </section>
  );
}
