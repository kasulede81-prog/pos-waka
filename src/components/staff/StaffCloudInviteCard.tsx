import { useCallback, useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { Body } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";
import type { Language, StaffAccount } from "../../types";
import { t } from "../../lib/i18n";
import { resolveShopCtx } from "../../offline/cloudSync";
import {
  invitePosRoleForStaff,
  listStaffInvitations,
  revokeStaffInvitation,
  sendStaffInvite,
  type StaffInvitationRow,
  type StaffInvitePosRole,
  STAFF_INVITE_POS_ROLES,
} from "../../lib/staffInvite";

type Props = {
  lang: Language;
  staff: StaffAccount[];
};

export function StaffCloudInviteCard({ lang, staff }: Props) {
  const [email, setEmail] = useState("");
  const [posRole, setPosRole] = useState<StaffInvitePosRole>("cashier");
  const [staffId, setStaffId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<StaffInvitationRow[]>([]);

  const refresh = useCallback(async () => {
    const ctx = await resolveShopCtx();
    if (!ctx) return;
    setInvites(await listStaffInvitations(ctx.shopId));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const ctx = await resolveShopCtx();
      if (!ctx) {
        setError(t(lang, "staffInviteNeedCloud"));
        return;
      }
      const result = await sendStaffInvite({
        shopId: ctx.shopId,
        email,
        posRole,
        staffId: staffId || null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(t(lang, "staffInviteSent"));
      setEmail("");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Resend = send again. `shop_invite_staff` revokes every still-pending invitation for this
   * (shop, email) and mints a FRESH 256-bit token with a fresh 7-day expiry, storing only the new
   * hash — so the previously emailed link stops working the moment this returns. That is already
   * exactly the semantics a "Resend" button needs, which is why this calls the same function as
   * the form above rather than introducing a second, narrower code path.
   */
  const resend = async (invite: StaffInvitationRow) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const ctx = await resolveShopCtx();
      if (!ctx) {
        setError(t(lang, "staffInviteNeedCloud"));
        return;
      }
      const result = await sendStaffInvite({
        shopId: ctx.shopId,
        email: invite.email,
        posRole: invitePosRoleForStaff(invite.pos_role),
        staffId: invite.staff_id,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage(t(lang, "staffInviteResent"));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const pending = invites.filter((i) => !i.accepted_at && !i.revoked_at);

  return (
    <EnterpriseCard title={t(lang, "staffInviteTitle")}>
      <Body className="!text-sm">{t(lang, "staffInviteSub")}</Body>
      {/* The product has two steps and always will: a staff PROFILE (name, role, PIN) is created on
          the Team page, and an EMAIL is invited here. They are deliberately not merged, because
          linking them is what `shop_invite_staff` does — and that RPC has no name parameter, so a
          combined form would have to invent one. Saying the order out loud is what keeps an owner
          from inviting an address and then wondering why a second, nameless profile appeared. */}
      <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-xs font-semibold text-muted-foreground">
        {t(lang, "staffInviteHowItWorks")}
      </p>
      {/* Every control is labelled now. The fields previously relied on placeholder text alone,
          which is not an accessible name and disappears as soon as anything is typed. */}
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-sm font-bold text-muted-foreground">{t(lang, "staffInviteEmailLabel")}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t(lang, "staffInviteEmailPh")}
            autoComplete="email"
            className="mt-1.5 w-full min-h-[48px] rounded-xl border border-border bg-card px-3 text-sm font-semibold"
          />
        </label>

        <p className="text-xs font-medium text-muted-foreground">{t(lang, "staffInviteGoogleNote")}</p>

        <label className="block">
          <span className="text-sm font-bold text-muted-foreground">{t(lang, "staffInviteRoleLabel")}</span>
          <select
            value={posRole}
            onChange={(e) => setPosRole(e.target.value as StaffInvitePosRole)}
            className="mt-1.5 w-full min-h-[48px] rounded-xl border border-border bg-card px-3 text-sm font-semibold"
          >
            {STAFF_INVITE_POS_ROLES.map((role) => (
              <option key={role} value={role}>
                {t(lang, `role_${role}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-bold text-muted-foreground">{t(lang, "staffInviteProfileLabel")}</span>
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="mt-1.5 w-full min-h-[48px] rounded-xl border border-border bg-card px-3 text-sm font-semibold"
          >
            <option value="">{t(lang, "staffInviteNewProfile")}</option>
            {staff.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} — {t(lang, `role_${row.role}`)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs font-medium text-muted-foreground">
            {t(lang, "staffInviteProfileHint")}
          </span>
        </label>

        {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
        {message ? <p role="status" className="text-sm font-semibold text-emerald-700">{message}</p> : null}
        <WakaButton variant="primary" disabled={busy || !email.includes("@")} onClick={() => void submit()}>
          <Mail className="h-4 w-4" aria-hidden />
          {busy ? t(lang, "staffInviteWorking") : t(lang, "staffInviteSend")}
        </WakaButton>
      </div>

      {pending.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {pending.map((invite) => (
            <li key={invite.id} className="rounded-xl bg-muted px-3 py-2">
              <p className="text-sm font-semibold text-foreground">
                {invite.email} · {t(lang, `role_${invite.pos_role}`)}
              </p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                {t(lang, "staffInvitePendingUntil")} {new Date(invite.expires_at).toLocaleDateString()}
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-[36px] text-xs font-black text-waka-700 disabled:opacity-50"
                  onClick={() => void resend(invite)}
                  data-testid={`staff-invite-resend-${invite.id}`}
                >
                  {t(lang, "staffInviteResend")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-[36px] text-xs font-black text-red-700 disabled:opacity-50"
                  onClick={() => {
                    // Revoking kills a link someone may already hold, so it is confirmed first —
                    // the same guard the delete action uses.
                    if (!window.confirm(t(lang, "staffInviteRevokeConfirm"))) return;
                    void revokeStaffInvitation(invite.id).then(() => refresh());
                  }}
                >
                  {t(lang, "staffInviteRevoke")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </EnterpriseCard>
  );
}
