import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { internalAdminShopHref } from "../../lib/internalAdminPreview";
import {
  deleteSubscriptionRequest,
  deleteSupportTicket,
  googleMapsDirectionsUrl,
  internalOpsOrgBillingOfferFulfill,
  internalOpsOrgBillingOfferSend,
  internalOpsSetSubscriptionRequestStatus,
  markFieldVisitCompleted,
  updateSupportTicketStatus,
  whatsappUrlFromPhone,
  type FieldVisitRow,
  type OrgBillingOfferStaffRow,
  type PendingSubscriptionRequestRow,
  type SupportTicketRow,
} from "../../lib/wakaInternalAdmin";
import { AdminOpsPanel } from "./adminUi";

type OpsPanelId = "shops" | "districts" | "map" | "plans" | "support" | "trials" | "annual" | "charts" | "visits";

type Props = {
  lang: Language;
  previewMode: boolean;
  activePanel: OpsPanelId | null;
  closePanel: () => void;
  opsLoading: boolean;
  pendingTrials: PendingSubscriptionRequestRow[];
  pendingAnnualTickets: SupportTicketRow[];
  tickets: SupportTicketRow[];
  visits: FieldVisitRow[];
  visitMsg: string | null;
  canManageTrials: boolean;
  canResolveSupport: boolean;
  canSendAnnualOffer: boolean;
  canManageBillingOffers: boolean;
  trialBusyId: string | null;
  setTrialBusyId: (v: string | null) => void;
  annualBusyId: string | null;
  setAnnualBusyId: (v: string | null) => void;
  annualSendBusy: string | null;
  setAnnualSendBusy: (v: string | null) => void;
  ticketBusyId: string | null;
  setTicketBusyId: (v: string | null) => void;
  visitBusyId: string | null;
  setVisitBusyId: (v: string | null) => void;
  setVisitMsg: (v: string | null) => void;
  setDeleteMsg: (v: string | null) => void;
  annualAmountByTicket: Record<string, string>;
  setAnnualAmountByTicket: Dispatch<SetStateAction<Record<string, string>>>;
  billingOfferRows: OrgBillingOfferStaffRow[];
  billingFulfillBusy: string | null;
  setBillingFulfillBusy: (v: string | null) => void;
  loadAll: () => Promise<void>;
};

export function InternalOpsQueuePanels({
  lang,
  previewMode,
  activePanel,
  closePanel,
  opsLoading,
  pendingTrials,
  pendingAnnualTickets,
  tickets,
  visits,
  visitMsg,
  canManageTrials,
  canResolveSupport,
  canSendAnnualOffer,
  canManageBillingOffers,
  trialBusyId,
  setTrialBusyId,
  annualBusyId,
  setAnnualBusyId,
  annualSendBusy,
  setAnnualSendBusy,
  ticketBusyId,
  setTicketBusyId,
  visitBusyId,
  setVisitBusyId,
  setVisitMsg,
  setDeleteMsg,
  annualAmountByTicket,
  setAnnualAmountByTicket,
  billingOfferRows,
  billingFulfillBusy,
  setBillingFulfillBusy,
  loadAll,
}: Props) {
  return (
    <>
      <AdminOpsPanel
        title={t(lang, "internalPendingTrialsTitle")}
        subtitle={t(lang, "internalPendingTrialsSub")}
        open={activePanel === "trials"}
        onClose={closePanel}
      >
        <ul className="space-y-2">
          {opsLoading && !pendingTrials.length ? (
            [...Array(3)].map((_, i) => <li key={i} className="h-14 animate-pulse rounded-xl bg-stone-100" />)
          ) : pendingTrials.length === 0 ? (
            <li className="rounded-xl border border-dashed border-stone-200 px-4 py-6 text-center text-sm font-semibold text-stone-600">
              {t(lang, "internalPendingTrialsEmpty")}
            </li>
          ) : (
            pendingTrials.map((req) => (
              <li
                key={req.id}
                className="flex flex-col gap-2 rounded-xl border border-stone-100 bg-stone-50/80 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-black text-stone-900">
                    {t(lang, "internalTrialPlanLabel")}:{" "}
                    <span className="uppercase text-orange-800">{req.requested_plan}</span>
                  </p>
                  <p className="font-mono text-xs text-stone-500">
                    org {req.organization_id.slice(0, 8)}… · {new Date(req.created_at).toLocaleString("en-GB")}
                  </p>
                  {req.shop_id ? (
                    <Link
                      to={internalAdminShopHref(req.shop_id, previewMode)}
                      onClick={closePanel}
                      className="text-xs font-black uppercase text-orange-800 underline"
                    >
                      {t(lang, "internalMapOpenShop")}
                    </Link>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canManageTrials ? (
                    <>
                      <button
                        type="button"
                        disabled={trialBusyId === `${req.id}-ok`}
                        onClick={async () => {
                          setTrialBusyId(`${req.id}-ok`);
                          const r = await internalOpsSetSubscriptionRequestStatus(req.id, "approved", null);
                          setTrialBusyId(null);
                          if (r.ok) {
                            window.dispatchEvent(new Event("waka:subscription-updated"));
                            void loadAll();
                          }
                        }}
                        className="h-7 rounded-lg bg-secondary px-3 text-xs font-black text-secondary-foreground disabled:opacity-40"
                      >
                        {trialBusyId === `${req.id}-ok` ? "…" : t(lang, "internalTrialApprove")}
                      </button>
                      <button
                        type="button"
                        disabled={trialBusyId === `${req.id}-no`}
                        onClick={async () => {
                          setTrialBusyId(`${req.id}-no`);
                          const r = await internalOpsSetSubscriptionRequestStatus(req.id, "rejected", "Rejected from dashboard");
                          setTrialBusyId(null);
                          if (r.ok) void loadAll();
                        }}
                        className="h-7 rounded-lg bg-destructive px-3 text-xs font-black text-destructive-foreground disabled:opacity-40"
                      >
                        {trialBusyId === `${req.id}-no` ? "…" : t(lang, "internalTrialReject")}
                      </button>
                      <button
                        type="button"
                        disabled={trialBusyId === `${req.id}-del`}
                        onClick={async () => {
                          if (!window.confirm("Delete this request?")) return;
                          setTrialBusyId(`${req.id}-del`);
                          setDeleteMsg(null);
                          const r = await deleteSubscriptionRequest(req.id);
                          setTrialBusyId(null);
                          if (r.ok) void loadAll();
                          else setDeleteMsg(r.message ?? "Delete failed.");
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-destructive/30 px-3 text-xs font-black text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {trialBusyId === `${req.id}-del` ? "…" : "Delete"}
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
      </AdminOpsPanel>

      <AdminOpsPanel
        title={t(lang, "internalAnnualQueueTitle")}
        subtitle={t(lang, "internalAnnualQueueSub")}
        open={activePanel === "annual"}
        onClose={closePanel}
        wide
      >
        <ul className="space-y-2">
          {pendingAnnualTickets.length === 0 ? (
            <li className="rounded-xl border border-dashed border-amber-200 px-4 py-6 text-center text-sm font-semibold text-stone-600">
              {t(lang, "internalAnnualQueueEmpty")}
            </li>
          ) : (
            pendingAnnualTickets.map((tk) => (
              <li key={tk.id} className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 text-sm">
                <p className="font-black text-stone-900">{tk.shop_name ?? "—"}</p>
                <p className="text-xs text-stone-600">
                  {tk.owner_email ?? "—"} · {tk.shop_phone_e164 ?? tk.contact_phone_e164 ?? "—"}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-stone-600">{tk.body ?? tk.subject}</p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-[10px] font-black uppercase text-stone-500">
                    {t(lang, "internalAnnualAmountUgx")}
                    <input
                      type="number"
                      min={1}
                      value={annualAmountByTicket[tk.id] ?? ""}
                      onChange={(e) => setAnnualAmountByTicket((prev) => ({ ...prev, [tk.id]: e.target.value }))}
                      className="mt-1 block w-32 rounded-lg border border-stone-200 px-2 py-1 text-sm font-bold"
                    />
                  </label>
                  {canSendAnnualOffer && tk.organization_id ? (
                    <button
                      type="button"
                      disabled={annualSendBusy === tk.id || !(Number(annualAmountByTicket[tk.id] ?? 0) > 0)}
                      onClick={async () => {
                        const amt = Math.floor(Number(annualAmountByTicket[tk.id] ?? 0));
                        if (!(amt > 0) || !tk.organization_id) return;
                        setAnnualSendBusy(tk.id);
                        const r = await internalOpsOrgBillingOfferSend(
                          tk.organization_id,
                          amt,
                          t(lang, "internalAnnualOfferDefaultNote"),
                          tk.shop_id ?? null,
                        );
                        setAnnualSendBusy(null);
                        if (r.ok) {
                          window.dispatchEvent(new Event("waka:subscription-updated"));
                          void loadAll();
                        }
                      }}
                      className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40"
                    >
                      {annualSendBusy === tk.id ? "…" : t(lang, "internalAnnualSendOffer")}
                    </button>
                  ) : null}
                  {canResolveSupport ? (
                    <>
                      <button
                        type="button"
                        disabled={annualBusyId === `${tk.id}-cl`}
                        onClick={async () => {
                          setAnnualBusyId(`${tk.id}-cl`);
                          const r = await updateSupportTicketStatus(tk.id, "closed");
                          setAnnualBusyId(null);
                          if (r.ok) void loadAll();
                        }}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-black"
                      >
                        {t(lang, "internalAnnualQueueClose")}
                      </button>
                      <button
                        type="button"
                        disabled={annualBusyId === `${tk.id}-del`}
                        onClick={async () => {
                          if (!window.confirm("Delete this request?")) return;
                          setAnnualBusyId(`${tk.id}-del`);
                          const r = await deleteSupportTicket(tk.id);
                          setAnnualBusyId(null);
                          if (r.ok) void loadAll();
                        }}
                        className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-black text-rose-700"
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ul>
        {billingOfferRows.length > 0 ? (
          <div className="mt-4 border-t border-stone-100 pt-4">
            <h3 className="text-sm font-black text-stone-900">{t(lang, "internalBillingOffersQueueTitle")}</h3>
            <ul className="mt-2 space-y-2">
              {billingOfferRows.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm">
                  <span className="font-mono text-xs">
                    UGX {Number(o.amount_ugx).toLocaleString("en-UG")} · {o.status}
                  </span>
                  {o.status === "claimed_paid" && canManageBillingOffers ? (
                    <button
                      type="button"
                      disabled={billingFulfillBusy === o.id}
                      onClick={async () => {
                        setBillingFulfillBusy(o.id);
                        const r = await internalOpsOrgBillingOfferFulfill(o.id, null);
                        setBillingFulfillBusy(null);
                        if (r.ok) {
                          window.dispatchEvent(new Event("waka:subscription-updated"));
                          void loadAll();
                        }
                      }}
                      className="rounded-lg bg-emerald-700 px-2 py-1 text-xs font-black text-white disabled:opacity-40"
                    >
                      {billingFulfillBusy === o.id ? "…" : t(lang, "internalBillingOfferFulfill")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </AdminOpsPanel>

      <AdminOpsPanel
        title={t(lang, "internalSupportTitle")}
        subtitle={t(lang, "internalSupportSub")}
        open={activePanel === "support"}
        onClose={closePanel}
        wide
      >
        <ul className="space-y-2">
          {opsLoading && !tickets.length ? (
            [...Array(4)].map((_, i) => <li key={i} className="h-16 animate-pulse rounded-xl bg-stone-100" />)
          ) : tickets.length === 0 ? (
            <li className="rounded-xl border border-dashed border-stone-200 px-4 py-6 text-center text-sm font-semibold text-stone-600">
              {t(lang, "internalSupportEmpty")}
            </li>
          ) : (
            tickets.map((tk) => {
              const waUrl = whatsappUrlFromPhone(tk.contact_phone_e164 ?? tk.shop_phone_e164);
              return (
                <li key={tk.id} className="rounded-xl border border-stone-100 bg-stone-50/60 p-3 text-sm">
                  <p className="font-black text-stone-900">{tk.subject || t(lang, "internalSupportNoSubject")}</p>
                  <p className="text-xs text-stone-500">
                    {[tk.shop_name, tk.shop_district].filter(Boolean).join(" · ")} · {tk.status} · {tk.priority}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tk.shop_id ? (
                      <Link
                        to={internalAdminShopHref(tk.shop_id, previewMode)}
                        onClick={closePanel}
                        className="rounded-md bg-orange-100 px-2 py-0.5 text-[10px] font-black uppercase text-orange-950"
                      >
                        Shop
                      </Link>
                    ) : null}
                    {waUrl ? (
                      <a href={waUrl} target="_blank" rel="noopener noreferrer" className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-black uppercase text-white">
                        {t(lang, "internalSupportWhatsapp")}
                      </a>
                    ) : null}
                    {canResolveSupport ? (
                      <>
                        <button
                          type="button"
                          disabled={ticketBusyId === `${tk.id}-rs`}
                          onClick={async () => {
                            setTicketBusyId(`${tk.id}-rs`);
                            const r = await updateSupportTicketStatus(tk.id, "resolved");
                            setTicketBusyId(null);
                            if (r.ok) void loadAll();
                          }}
                          className="rounded-lg bg-stone-900 px-2 py-1 text-xs font-black text-white disabled:opacity-40"
                        >
                          {t(lang, "internalSupportMarkResolved")}
                        </button>
                        <button
                          type="button"
                          disabled={ticketBusyId === `${tk.id}-del`}
                          onClick={async () => {
                            if (!window.confirm("Delete this support request?")) return;
                            setTicketBusyId(`${tk.id}-del`);
                            const r = await deleteSupportTicket(tk.id);
                            setTicketBusyId(null);
                            if (r.ok) void loadAll();
                          }}
                          className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-black text-rose-700"
                        >
                          Delete
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </AdminOpsPanel>

      <AdminOpsPanel
        title={t(lang, "internalFieldVisitsTitle")}
        open={activePanel === "visits"}
        onClose={closePanel}
      >
        {visitMsg ? <p className="mb-2 text-sm font-bold text-rose-600">{visitMsg}</p> : null}
        <ul className="space-y-2">
          {visits.length === 0 ? (
            <li className="rounded-xl border border-dashed border-stone-200 px-4 py-6 text-center text-sm font-semibold text-stone-600">
              {t(lang, "internalVisitNoOpen")}
            </li>
          ) : (
            visits.map((v) => {
              const shop = v.shops;
              const lat = shop?.latitude ?? null;
              const lng = shop?.longitude ?? null;
              const canDir = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
              return (
                <li key={v.id} className="rounded-xl border border-stone-100 bg-stone-50/60 p-3">
                  <p className="font-black text-stone-900">{shop?.name ?? v.shop_id}</p>
                  <p className="text-xs text-stone-500">{[shop?.district, shop?.city].filter(Boolean).join(" · ") || "—"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canDir ? (
                      <a
                        href={googleMapsDirectionsUrl(lat!, lng!)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-black text-white"
                      >
                        {t(lang, "internalVisitDirections")}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      disabled={visitBusyId === v.id}
                      onClick={async () => {
                        setVisitMsg(null);
                        setVisitBusyId(v.id);
                        const r = await markFieldVisitCompleted(v.id);
                        setVisitBusyId(null);
                        if (!r.ok) setVisitMsg(r.message ?? t(lang, "internalVisitDoneError"));
                        else void loadAll();
                      }}
                      className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-black disabled:opacity-50"
                    >
                      {visitBusyId === v.id ? "…" : t(lang, "internalVisitDone")}
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </AdminOpsPanel>
    </>
  );
}
