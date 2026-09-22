import { useState } from "react";
import type { Language } from "../../../../types";
import { t } from "../../../../lib/i18n";
import { internalAdminShopTabHref } from "../../../../lib/internalAdminPreview";
import { formatDisplayEmail } from "../../../../lib/wakaInternalAdmin";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  deleteSupportTicket,
  updateSupportTicketStatus,
  whatsappUrlFromPhone,
} from "../../../../lib/wakaInternalAdmin";
import { useInternalOpsData } from "../../../../hooks/useInternalOpsData";
import { adminPermissions } from "../adminRoles";
import { useNavigate } from "@/lib/routerCompat";
import { EmptyState, SupportTicketCard } from "../primitives";
import { RemoteSupportTicketConnect } from "../../../remote-support/RemoteSupportTicketConnect";
import { TicketInternalNotesPanel } from "../../ops/TicketInternalNotesPanel";
import { MerchantTicketsConsole } from "../ops/MerchantTicketsConsole";
import { Inbox } from "lucide-react";
import { WakaSupportQueueSkeleton } from "../../../enterprise/WakaLoading";

type Props = {
  lang: Language;
  adminRow: WakaInternalAdminRow | null;
  previewMode: boolean;
};

export function AdminSupportPage({ lang, adminRow, previewMode }: Props) {
  const navigate = useNavigate();
  const perms = adminPermissions(adminRow);
  const data = useInternalOpsData(adminRow, previewMode, "support");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");

  const list =
    filter === "open"
      ? data.openSupportTickets
      : data.tickets;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-foreground">{t(lang, "internalSupportTitle")}</h1>
        <p className="text-sm text-muted-foreground">Helpdesk inbox</p>
        <p className="mt-1 text-xs font-semibold text-muted-foreground">
          Shared team queue. Account recovery and device interventions live in the Customer Workspace.
        </p>
      </div>

      <MerchantTicketsConsole
        lang={lang}
        canWorkTickets={perms.role === "super_admin" || perms.role === "support_admin"}
        previewMode={previewMode}
      />

      <h2 className="pt-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
        Legacy intake — app reports &amp; pilot tickets
      </h2>
      <div className="flex gap-2">
        {(["open", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`min-h-[44px] rounded-full px-4 text-xs font-black uppercase ${
              filter === f ? "bg-waka-600 text-white" : "bg-card ring-1 ring-border"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {data.opsLoading && list.length === 0 ? (
        <WakaSupportQueueSkeleton />
      ) : list.length === 0 ? (
        <EmptyState><Inbox className="mx-auto mb-2 size-5" aria-hidden />{t(lang, "internalSupportEmpty")}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.map((tk) => {
            const phone = tk.shop_phone_e164 ?? tk.contact_phone_e164 ?? undefined;
            const ownerEmail = formatDisplayEmail(tk.owner_email);
            const shopId = tk.shop_id;
            return (
              <li key={tk.id}>
                <SupportTicketCard
                  title={tk.subject ?? tk.issue_type ?? "Support"}
                  shopName={tk.shop_name ?? "—"}
                  ownerEmail={ownerEmail}
                  phone={phone}
                  status={tk.status}
                  timeLabel={new Date(tk.created_at).toLocaleString("en-GB")}
                  showActions={perms.canResolveSupport && !previewMode}
                  onWhatsApp={
                    phone
                      ? () => {
                          const url = whatsappUrlFromPhone(phone);
                          if (url) window.open(url, "_blank", "noopener,noreferrer");
                        }
                      : undefined
                  }
                  onResolve={
                    perms.canResolveSupport
                      ? async () => {
                          setBusyId(tk.id);
                          await updateSupportTicketStatus(tk.id, "closed");
                          setBusyId(null);
                          void data.loadAll();
                        }
                      : undefined
                  }
                  onOpenShop={
                    shopId
                      ? () => navigate(internalAdminShopTabHref(shopId, "support", previewMode))
                      : undefined
                  }
                  onDelete={
                    perms.canResolveSupport
                      ? async () => {
                          if (!window.confirm("Delete ticket?")) return;
                          setBusyId(tk.id);
                          await deleteSupportTicket(tk.id);
                          setBusyId(null);
                          void data.loadAll();
                        }
                      : undefined
                  }
                />
                {tk.device_fingerprint || tk.app_version ? (
                  <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
                    {tk.issue_type ? `${tk.issue_type} · ` : ""}
                    {tk.app_version ? `v${tk.app_version}` : ""}
                    {tk.device_fingerprint ? ` · ${tk.device_fingerprint.slice(0, 18)}` : ""}
                  </p>
                ) : null}
                <RemoteSupportTicketConnect
                  lang={lang}
                  ticket={tk}
                  technicianName={adminRow?.full_name || adminRow?.email || "WAKA Support"}
                  canRemoteSupport={perms.canRemoteSupport}
                  previewMode={previewMode}
                />
                {tk.issue_type === "pilot_support" && tk.diagnostics_json ? (
                  <details className="mt-2 rounded-xl border border-teal-200 bg-teal-50/50 p-2 text-xs">
                    <summary className="cursor-pointer font-black text-teal-900">Pilot diagnostics</summary>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(tk.diagnostics_json, null, 2)}
                    </pre>
                    {tk.app_version ? <p className="mt-1">App v{tk.app_version}</p> : null}
                    {tk.screenshot_meta ? (
                      <p className="text-muted-foreground">Screenshot: {JSON.stringify(tk.screenshot_meta)}</p>
                    ) : null}
                  </details>
                ) : null}
                <TicketInternalNotesPanel ticketId={tk.id} />
                {busyId === tk.id ? (
                  <p className="mt-1 text-center text-xs font-bold text-muted-foreground">Updating…</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
