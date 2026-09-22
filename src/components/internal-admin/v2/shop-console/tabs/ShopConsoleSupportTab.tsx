import { useEffect } from "react";
import { InternalNotesPanel } from "../../ops/OpsWidgets";
import { AdminCollapsible } from "../../../adminUi";
import {
  adminShopOpenSupportMessage,
  whatsappUrlFromPhone,
} from "../../../../../lib/wakaInternalAdmin";
import { t } from "../../../../../lib/i18n";
import type { ShopConsoleState } from "../useShopConsoleState";

type Props = { ctx: ShopConsoleState };

export function ShopConsoleSupportTab({ ctx }: Props) {
  const {
    lang,
    detail,
    adminRow,
    canSupport,
    busy,
    previewMode,
    supportSubject,
    setSupportSubject,
    supportBody,
    setSupportBody,
    executeAction,
    setToast,
    loadRescueData,
  } = ctx;

  useEffect(() => {
    void loadRescueData();
  }, [loadRescueData]);

  if (!detail) return null;

  const waUrl = whatsappUrlFromPhone(detail.shop.phone_e164);

  return (
    <div className="space-y-3">
      <AdminCollapsible title="Internal notes" summary="Staff only" defaultOpen>
        <InternalNotesPanel
          shopId={detail.shop.id}
          author={adminRow?.full_name ?? adminRow?.email ?? "Staff"}
          previewMode={previewMode}
          lang={lang}
          onToast={setToast}
        />
      </AdminCollapsible>

      {canSupport ? (
        <AdminCollapsible title={t(lang, "internalShopProfileSupportTitle")} summary={t(lang, "internalShopProfileSupportSub")}>
          <label className="block text-xs font-bold text-muted-foreground">
            {t(lang, "internalShopProfileSupportSubject")}
            <input
              value={supportSubject}
              onChange={(e) => setSupportSubject(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-xl border border-border px-3 text-sm font-semibold text-foreground"
              placeholder="…"
            />
          </label>
          <label className="mt-3 block text-xs font-bold text-muted-foreground">
            {t(lang, "internalShopProfileSupportBody")}
            <textarea
              value={supportBody}
              onChange={(e) => setSupportBody(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm font-semibold text-foreground"
              placeholder="…"
            />
          </label>
          <button
            type="button"
            disabled={busy || !supportBody.trim()}
            className="mt-3 min-h-[44px] w-full rounded-xl bg-violet-600 text-sm font-black text-white disabled:opacity-40"
            onClick={() =>
              void executeAction(
                "admin_support_message",
                async () => {
                  const r = await adminShopOpenSupportMessage(
                    detail.shop.id,
                    supportSubject.trim() || "Staff note",
                    supportBody.trim(),
                  );
                  if (r.ok) {
                    setSupportSubject("");
                    setSupportBody("");
                  }
                  return r;
                },
                { permitted: canSupport },
              )
            }
          >
            {t(lang, "internalShopProfileSupportSend")}
          </button>
        </AdminCollapsible>
      ) : null}

      {waUrl ? (
        <a href={waUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[40px] items-center rounded-xl border border-border px-3 text-xs font-black text-foreground">
          Contact customer on WhatsApp
        </a>
      ) : null}
    </div>
  );
}
