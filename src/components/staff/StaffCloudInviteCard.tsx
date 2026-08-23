import { useCallback, useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { Body } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";
import type { Language, StaffAccount } from "../../types";
import { t } from "../../lib/i18n";
import { resolveShopCtx } from "../../offline/cloudSync";
import {
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

  const pending = invites.filter((i) => !i.accepted_at && !i.revoked_at);

  return (
    <EnterpriseCard title={t(lang, "staffInviteTitle")}>
      <Body className="!text-sm">{t(lang, "staffInviteSub")}</Body>
      <div className="mt-3 space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t(lang, "staffInviteEmailPh")}
          className="w-full min-h-[48px] rounded-xl border border-border bg-card px-3 text-sm font-semibold"
        />
        <select
          value={posRole}
          onChange={(e) => setPosRole(e.target.value as StaffInvitePosRole)}
          className="w-full min-h-[48px] rounded-xl border border-border bg-card px-3 text-sm font-semibold"
        >
          {STAFF_INVITE_POS_ROLES.map((role) => (
            <option key={role} value={role}>
              {t(lang, `role_${role}`)}
            </option>
          ))}
        </select>
        <select
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          className="w-full min-h-[48px] rounded-xl border border-border bg-card px-3 text-sm font-semibold"
        >
          <option value="">{t(lang, "staffInviteNewProfile")}</option>
          {staff.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name} — {t(lang, `role_${row.role}`)}
            </option>
          ))}
        </select>
        {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
        {message ? <p className="text-sm font-semibold text-emerald-700">{message}</p> : null}
        <WakaButton variant="primary" disabled={busy || !email.includes("@")} onClick={() => void submit()}>
          <Mail className="h-4 w-4" aria-hidden />
          {busy ? t(lang, "staffInviteWorking") : t(lang, "staffInviteSend")}
        </WakaButton>
      </div>

      {pending.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {pending.map((invite) => (
            <li key={invite.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2">
              <span className="text-sm font-semibold">
                {invite.email} · {invite.pos_role}
              </span>
              <button
                type="button"
                className="text-xs font-black text-red-700"
                onClick={() => {
                  void revokeStaffInvitation(invite.id).then(() => refresh());
                }}
              >
                {t(lang, "staffInviteRevoke")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </EnterpriseCard>
  );
}
