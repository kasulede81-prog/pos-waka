import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Megaphone } from "lucide-react";
import type { Language } from "../../../../types";
import { t } from "../../../../lib/i18n";
import { internalAdminPreviewHref } from "../../../../lib/internalAdminPreview";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { greetingKey, kampalaNowParts, useInternalOpsData, type OpsSheetId } from "../../../../hooks/useInternalOpsData";
import { adminPermissions } from "../adminRoles";
import {
  ActivityFeedPanel,
  AnnouncementSheet,
  GlobalSearchBar,
  SystemStatusCenter,
} from "../ops/OpsWidgets";
import { adminKpiGridClass } from "../../../../lib/desktopLayout";
import { AdminHeroV2, BottomSheet, EmptyState, KpiPulseCard } from "../primitives";
import { InternalOpsQueuePanels } from "../../InternalOpsQueuePanels";

type Props = {
  lang: Language;
  email: string | null | undefined;
  adminRow: WakaInternalAdminRow | null;
  previewMode: boolean;
};

export function AdminOverviewPage({ lang, email, adminRow, previewMode }: Props) {
  const navigate = useNavigate();
  const { hour, dateStr } = kampalaNowParts();
  const perms = adminPermissions(adminRow);
  const data = useInternalOpsData(adminRow, previewMode, "overview");

  const [activeSheet, setActiveSheet] = useState<OpsSheetId>(null);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [trialBusyId, setTrialBusyId] = useState<string | null>(null);
  const [annualBusyId, setAnnualBusyId] = useState<string | null>(null);
  const [annualSendBusy, setAnnualSendBusy] = useState<string | null>(null);
  const [ticketBusyId, setTicketBusyId] = useState<string | null>(null);
  const [visitBusyId, setVisitBusyId] = useState<string | null>(null);
  const [visitMsg, setVisitMsg] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [annualAmountByTicket, setAnnualAmountByTicket] = useState<Record<string, string>>({});
  const [billingFulfillBusy, setBillingFulfillBusy] = useState<string | null>(null);

  const displayName =
    adminRow?.full_name?.trim() ||
    (adminRow?.email ? adminRow.email.split("@")[0] : (email ?? "").split("@")[0]) ||
    "Team";

  const panelId = activeSheet === "trials" ? "trials" : activeSheet === "annual" ? "annual" : activeSheet === "support" ? "support" : activeSheet === "visits" ? "visits" : null;

  const go = (path: string) => navigate(previewMode ? internalAdminPreviewHref(path) : path);

  return (
    <div className="space-y-5">
      <AdminHeroV2
        greeting={t(lang, greetingKey(hour))}
        firstName={displayName}
        dateLabel={dateStr}
        roleLabel={perms.role.replace(/_/g, " ")}
        districtCount={perms.districtCount}
        onRefresh={() => void (previewMode ? data.seedPreview() : data.loadAll())}
        refreshing={data.opsLoading}
        previewBadge={previewMode}
      />

      <GlobalSearchBar shops={data.shopOpenings} tickets={data.tickets} previewMode={previewMode} />

      <SystemStatusCenter health={data.systemHealth} />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAnnounceOpen(true)}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white text-sm font-black text-stone-800 shadow-sm"
        >
          <Megaphone className="h-4 w-4 text-orange-600" />
          Broadcast
        </button>
        <button
          type="button"
          onClick={() => go("/internal/waka/analytics")}
          className="min-h-[44px] flex-1 rounded-2xl bg-orange-600 text-sm font-black text-white shadow-sm"
        >
          Analytics
        </button>
      </div>

      {previewMode ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950">
          {t(lang, "internalAdminPreviewOverviewHint")}
        </p>
      ) : null}

      {!previewMode && data.statsError ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800">
          {t(lang, "internalStatsError")}
          {data.statsErrorMessage ? <span className="mt-1 block font-mono text-[11px]">{data.statsErrorMessage}</span> : null}
        </p>
      ) : null}

      {deleteMsg ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800">{deleteMsg}</p>
      ) : null}

      <ActivityFeedPanel events={data.activityFeed} previewMode={previewMode} />

      <section>
        <h2 className="mb-2 text-xs font-black uppercase tracking-wide text-stone-500">Quick pulse</h2>
        <div className={adminKpiGridClass()}>
          <KpiPulseCard label={t(lang, "internalStat_totalShops")} value={data.statGrid.total} onOpen={() => go("/internal/waka/shops")} />
          <KpiPulseCard label={t(lang, "internalStat_activeToday")} value={data.statGrid.active} onOpen={() => go("/internal/waka/shops")} />
          <KpiPulseCard label={t(lang, "internalStat_paidSubs")} value={data.statGrid.paid} onOpen={() => go("/internal/waka/billing")} />
          <KpiPulseCard label="Devices" value={data.statGrid.devices} onOpen={() => go("/internal/waka/devices")} />
          <KpiPulseCard label={t(lang, "internalStat_supportOpen")} value={data.statGrid.support} onOpen={() => go("/internal/waka/support")} />
          <KpiPulseCard label={t(lang, "internalStat_pendingAnnual")} value={data.statGrid.pendingAnnual} onOpen={() => setActiveSheet("annual")} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-black uppercase tracking-wide text-stone-500">Work queues</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => setActiveSheet("trials")} className="min-h-[44px] rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-bold shadow-sm">
            Trials <span className="font-mono text-orange-600">{data.pendingTrials.length}</span>
          </button>
          <button type="button" onClick={() => setActiveSheet("annual")} className="min-h-[44px] rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-bold shadow-sm">
            Annual <span className="font-mono text-orange-600">{data.pendingAnnualTickets.length}</span>
          </button>
          <button type="button" onClick={() => go("/internal/waka/support")} className="min-h-[44px] rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-bold shadow-sm">
            Support inbox
          </button>
          <button type="button" onClick={() => setActiveSheet("visits")} className="min-h-[44px] rounded-2xl border border-stone-200 bg-white px-4 py-3 text-left text-sm font-bold shadow-sm">
            Field visits <span className="font-mono text-orange-600">{data.visits.length}</span>
          </button>
        </div>
      </section>

      <InternalOpsQueuePanels
        lang={lang}
        previewMode={previewMode}
        activePanel={panelId}
        closePanel={() => setActiveSheet(null)}
        opsLoading={data.opsLoading}
        pendingTrials={data.pendingTrials}
        pendingAnnualTickets={data.pendingAnnualTickets}
        tickets={data.tickets}
        visits={data.visits}
        visitMsg={visitMsg}
        canManageTrials={perms.canManageTrials}
        canResolveSupport={perms.canResolveSupport}
        canSendAnnualOffer={perms.canSendAnnualOffer}
        canManageBillingOffers={perms.canManageBillingOffers}
        trialBusyId={trialBusyId}
        setTrialBusyId={setTrialBusyId}
        annualBusyId={annualBusyId}
        setAnnualBusyId={setAnnualBusyId}
        annualSendBusy={annualSendBusy}
        setAnnualSendBusy={setAnnualSendBusy}
        ticketBusyId={ticketBusyId}
        setTicketBusyId={setTicketBusyId}
        visitBusyId={visitBusyId}
        setVisitBusyId={setVisitBusyId}
        setVisitMsg={setVisitMsg}
        setDeleteMsg={setDeleteMsg}
        annualAmountByTicket={annualAmountByTicket}
        setAnnualAmountByTicket={setAnnualAmountByTicket}
        billingOfferRows={data.billingOfferRows}
        billingFulfillBusy={billingFulfillBusy}
        setBillingFulfillBusy={setBillingFulfillBusy}
        loadAll={data.loadAll}
      />

      <BottomSheet open={activeSheet === "map"} onClose={() => setActiveSheet(null)} title="Field map" wide>
        {data.mapPins.length === 0 ? (
          <EmptyState>No GPS pins yet.</EmptyState>
        ) : (
          <p className="text-sm font-semibold text-stone-600">{data.mapPins.length} shops with GPS on the map.</p>
        )}
        <button
          type="button"
          onClick={() => go("/internal/waka/shops")}
          className="mt-4 min-h-[44px] w-full rounded-2xl bg-orange-600 text-sm font-black text-white"
        >
          Browse shops
        </button>
      </BottomSheet>

      <AnnouncementSheet open={announceOpen} onClose={() => setAnnounceOpen(false)} author={displayName} />
    </div>
  );
}
