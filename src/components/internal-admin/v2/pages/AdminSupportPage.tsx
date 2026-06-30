import { useState } from "react";
import type { Language } from "../../../../types";
import { t } from "../../../../lib/i18n";
import { internalAdminShopRescueHref } from "../../../../lib/internalAdminPreview";
import { formatDisplayEmail } from "../../../../lib/wakaInternalAdmin";
import type { WakaInternalAdminRow } from "../../../../lib/wakaInternalAdmin";
import {
  deleteSupportTicket,
  updateSupportTicketStatus,
  whatsappUrlFromPhone,
} from "../../../../lib/wakaInternalAdmin";
import { useInternalOpsData } from "../../../../hooks/useInternalOpsData";
import { adminPermissions } from "../adminRoles";
import { useNavigate } from "react-router-dom";
import { EmptyState, SupportTicketCard } from "../primitives";
import { AdminPasswordResetLogPanel } from "../../AdminPasswordResetLogPanel";
import { SupportPasswordResetPanel } from "../../SupportPasswordResetPanel";
import { AdminDiagnosticsImportPanel } from "../../ops/AdminDiagnosticsImportPanel";
import { TicketInternalNotesPanel } from "../../ops/TicketInternalNotesPanel";

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
  const [passwordLogKey, setPasswordLogKey] = useState(0);

  const list =
    filter === "open"
      ? data.openSupportTickets
      : data.tickets;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-stone-900">{t(lang, "internalSupportTitle")}</h1>
        <p className="text-sm text-stone-500">Helpdesk inbox</p>
        {perms.canShopSupport ? (
          <p className="mt-1 text-xs font-semibold text-amber-900">
            Reset owner login or back office PIN: Shops → open shop → <strong>Account recovery</strong> card, or use the
            tool below.
          </p>
        ) : null}
      </div>

      {perms.canShopSupport && (perms.role === "super_admin" || perms.role === "support_admin") ? (
        <SupportPasswordResetPanel
          previewMode={previewMode}
          onSuccess={() => setPasswordLogKey((k) => k + 1)}
          onToast={(toast) => {
            if (toast.kind === "ok") window.alert(toast.text);
            else window.alert(toast.text);
          }}
        />
      ) : null}

      {perms.canShopSupport ? (
        <AdminPasswordResetLogPanel key={passwordLogKey} previewMode={previewMode} />
      ) : null}

      <AdminDiagnosticsImportPanel previewMode={previewMode} />

      <div className="flex gap-2">
        {(["open", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`min-h-[44px] rounded-full px-4 text-xs font-black uppercase ${
              filter === f ? "bg-waka-600 text-white" : "bg-white ring-1 ring-stone-200"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {data.opsLoading && list.length === 0 ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-stone-200" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState>{t(lang, "internalSupportEmpty")}</EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.map((tk) => {
            const phone = tk.shop_phone_e164 ?? tk.contact_phone_e164 ?? undefined;
            const ownerEmail = formatDisplayEmail(tk.owner_email);
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
                    tk.shop_id
                      ? () => navigate(internalAdminShopRescueHref(tk.shop_id!, previewMode))
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
                {tk.issue_type === "pilot_support" && tk.diagnostics_json ? (
                  <details className="mt-2 rounded-xl border border-teal-200 bg-teal-50/50 p-2 text-xs">
                    <summary className="cursor-pointer font-black text-teal-900">Pilot diagnostics</summary>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-stone-700">
                      {JSON.stringify(tk.diagnostics_json, null, 2)}
                    </pre>
                    {tk.app_version ? <p className="mt-1">App v{tk.app_version}</p> : null}
                    {tk.screenshot_meta ? (
                      <p className="text-stone-600">Screenshot: {JSON.stringify(tk.screenshot_meta)}</p>
                    ) : null}
                  </details>
                ) : null}
                <TicketInternalNotesPanel ticketId={tk.id} />
                {busyId === tk.id ? (
                  <p className="mt-1 text-center text-xs font-bold text-stone-500">Updating…</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
