import { useState } from "react";
import type { Language } from "../../../../types";
import { t } from "../../../../lib/i18n";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import { useInternalOpsData } from "../../../../hooks/useInternalOpsData";
import { adminPermissions } from "../adminRoles";
import { PlanCardV2 } from "../primitives";
import { InternalOpsQueuePanels } from "../../InternalOpsQueuePanels";

type Props = {
  lang: Language;
  adminRow: WakaInternalAdminRow | null;
  previewMode: boolean;
};

function planNameKey(code: string): string {
  if (code === "starter") return "planStarterName";
  if (code === "business") return "planBusinessName";
  return "planWakaPlusName";
}

export function AdminBillingPage({ lang, adminRow, previewMode }: Props) {
  const perms = adminPermissions(adminRow);
  const data = useInternalOpsData(adminRow, previewMode, "billing");
  const [sheet, setSheet] = useState<"annual" | null>(null);
  const [trialBusyId, setTrialBusyId] = useState<string | null>(null);
  const [annualBusyId, setAnnualBusyId] = useState<string | null>(null);
  const [annualSendBusy, setAnnualSendBusy] = useState<string | null>(null);
  const [ticketBusyId, setTicketBusyId] = useState<string | null>(null);
  const [visitBusyId, setVisitBusyId] = useState<string | null>(null);
  const [visitMsg, setVisitMsg] = useState<string | null>(null);
  const [, setDeleteMsg] = useState<string | null>(null);
  const [annualAmountByTicket, setAnnualAmountByTicket] = useState<Record<string, string>>({});
  const [billingFulfillBusy, setBillingFulfillBusy] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-stone-900">Billing</h1>
        <p className="text-sm text-stone-500">Plans & annual requests</p>
      </div>

      <div className="space-y-3">
        {data.opsLoading && data.plans.length === 0 ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-stone-200" />
            ))}
          </div>
        ) : data.plans.length === 0 ? (
          <p className="rounded-2xl border border-stone-200 bg-white px-4 py-6 text-center text-sm font-semibold text-stone-500">
            No billing plan metrics yet.
          </p>
        ) : (
          data.plans.map((plan) => (
            <PlanCardV2
              key={plan.code}
              name={t(lang, planNameKey(plan.code) as "planStarterName")}
              activeCount={plan.activeCount}
              trialCount={plan.trialCount}
              expiringCount={plan.expiringSoonCount}
              mrrUgx={plan.estimatedMonthlyRevenueUgx}
            />
          ))
        )}
      </div>

      <div className="grid gap-2">
        <button
          type="button"
          onClick={() => setSheet("annual")}
          className="min-h-[44px] rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm font-black text-amber-950"
        >
          Annual requests ({data.pendingAnnualTickets.length})
        </button>
      </div>

      <InternalOpsQueuePanels
        lang={lang}
        previewMode={previewMode}
        activePanel={sheet === "annual" ? "annual" : null}
        closePanel={() => setSheet(null)}
        opsLoading={data.opsLoading}
        pendingTrials={[]}
        pendingAnnualTickets={data.pendingAnnualTickets}
        tickets={data.tickets}
        visits={[]}
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
    </div>
  );
}
