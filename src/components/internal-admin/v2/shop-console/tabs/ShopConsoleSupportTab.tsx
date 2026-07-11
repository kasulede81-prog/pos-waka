import { useEffect } from "react";
import { InternalNotesPanel } from "../../ops/OpsWidgets";
import { SupportPasswordResetPanel } from "../../../SupportPasswordResetPanel";
import { AdminCollapsible } from "../../../adminUi";
import { RescueActionButton, RescueSection } from "../../../rescue/RescuePrimitives";
import { fetchShopRecoverySignals, logRescueSupportAction } from "../../../../../lib/rescueSupportActions";
import {
  adminShopForceLogoutDevices,
  adminShopOpenSupportMessage,
  adminShopResetBackOfficePin,
  adminShopResetSync,
  adminShopSendOwnerPasswordReset,
  adminShopLogPasswordResetEmail,
  whatsappUrlFromPhone,
  formatDisplayEmail,
} from "../../../../../lib/wakaInternalAdmin";
import { sendOwnerPasswordResetEmail } from "../../../../../lib/shopRecoverySignals";
import { t } from "../../../../../lib/i18n";
import { runShopConsoleRescueAction } from "../rescueRun";
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
    setRescueField,
    rescue,
    loadRescueData,
  } = ctx;

  useEffect(() => {
    void loadRescueData();
  }, [loadRescueData]);

  if (!detail) return null;

  const ownerEmail = formatDisplayEmail(detail.owner_email);
  const waUrl = whatsappUrlFromPhone(detail.shop.phone_e164);

  const refreshRecoverySignals = async () => {
    if (!detail.shop.id) return;
    const signals = await fetchShopRecoverySignals(detail.shop.id);
    setRescueField("recoverySignals", signals);
  };

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

      {canSupport ? (
        <RescueSection id="support-actions" title="Support Actions" summary="Non-destructive recovery tools">
          <div className="flex flex-wrap gap-2">
            <RescueActionButton
              disabled={busy || !ownerEmail}
              onClick={() =>
                void runShopConsoleRescueAction(ctx, "rescue_password_reset", async () => {
                  const audit = await adminShopSendOwnerPasswordReset(detail.shop.id);
                  if (!audit.ok) return audit;
                  const email = audit.ownerEmail ?? ownerEmail ?? "";
                  if (!email) return { ok: false, message: "No owner email on file." };
                  const sent = await sendOwnerPasswordResetEmail(email);
                  await adminShopLogPasswordResetEmail(
                    detail.shop.id,
                    sent.ok,
                    sent.ok ? `Email sent to ${email}` : sent.message ?? "send_failed",
                  );
                  return sent;
                })
              }
            >
              Password reset
            </RescueActionButton>
            <RescueActionButton
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void runShopConsoleRescueAction(ctx, "rescue_pin_reset", async () => {
                  const r = await adminShopResetBackOfficePin(detail.shop.id);
                  if (r.ok) await refreshRecoverySignals();
                  return r;
                })
              }
            >
              PIN reset
            </RescueActionButton>
            <RescueActionButton
              variant="secondary"
              disabled={busy}
              onClick={() => void runShopConsoleRescueAction(ctx, "rescue_force_logout", () => adminShopForceLogoutDevices(detail.shop.id))}
            >
              Force logout
            </RescueActionButton>
            <RescueActionButton
              variant="secondary"
              disabled={busy}
              onClick={() => void runShopConsoleRescueAction(ctx, "rescue_retry_sync", () => adminShopResetSync(detail.shop.id))}
            >
              Retry sync
            </RescueActionButton>
            {waUrl ? (
              <RescueActionButton
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  window.open(waUrl, "_blank", "noopener,noreferrer");
                  void logRescueSupportAction({
                    shopId: detail.shop.id,
                    action: "rescue_whatsapp_contact",
                    result: "ok",
                  });
                }}
              >
                WhatsApp shortcut
              </RescueActionButton>
            ) : null}
          </div>
          {rescue.recoverySignals.passwordResetRequestedAt || rescue.recoverySignals.clearBackOfficePinAt ? (
            <dl className="mt-3 grid gap-2 text-xs text-muted-foreground">
              {rescue.recoverySignals.passwordResetRequestedAt ? (
                <div>Password reset signal: {new Date(rescue.recoverySignals.passwordResetRequestedAt).toLocaleString("en-GB")}</div>
              ) : null}
              {rescue.recoverySignals.clearBackOfficePinAt ? (
                <div>PIN reset signal: {new Date(rescue.recoverySignals.clearBackOfficePinAt).toLocaleString("en-GB")}</div>
              ) : null}
            </dl>
          ) : null}
        </RescueSection>
      ) : null}

      {canSupport ? (
        <SupportPasswordResetPanel
          lang={lang}
          previewMode={previewMode}
          onToast={setToast}
        />
      ) : null}
    </div>
  );
}
