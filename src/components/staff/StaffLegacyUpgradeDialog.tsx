import { useEffect, useState } from "react";
import { CloudUpload, Mail } from "lucide-react";
import { EnterpriseCard } from "../enterprise/EnterpriseCard";
import { Body } from "../enterprise/EnterpriseTypography";
import { WakaButton } from "../ui/wakaPrimitives";
import type { Language, StaffAccount } from "../../types";
import { t } from "../../lib/i18n";
import { resolveShopCtx } from "../../offline/cloudSync";
import {
  invitePosRoleForStaff,
  isLegacyPinStaffUpgradeable,
  sendStaffInvite,
} from "../../lib/staffInvite";

type Props = {
  lang: Language;
  staff: StaffAccount | null;
  open: boolean;
  onClose: () => void;
  onSent: () => void;
};

export function StaffLegacyUpgradeDialog({ lang, staff, open, onClose, onSent }: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !staff) return;
    setEmail((staff.email ?? "").trim());
    setError(null);
    setMessage(null);
  }, [open, staff]);

  if (!open || !staff) return null;

  const eligible = isLegacyPinStaffUpgradeable(staff);
  const posRole = invitePosRoleForStaff(staff.role);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (!eligible) {
        setError(t(lang, "staffUpgradeAlreadyLinked"));
        return;
      }
      const ctx = await resolveShopCtx();
      if (!ctx) {
        setError(t(lang, "staffInviteNeedCloud"));
        return;
      }
      const trimmed = email.trim().toLowerCase();
      if (!trimmed.includes("@")) {
        setError(t(lang, "staffInviteEmailPh"));
        return;
      }
      const result = await sendStaffInvite({
        shopId: ctx.shopId,
        email: trimmed,
        posRole,
        staffId: staff.id,
      });
      if (!result.ok) {
        const code = result.message;
        if (code === "staff_already_linked" || code.includes("staff_already_linked")) {
          setError(t(lang, "staffUpgradeAlreadyLinked"));
        } else if (code === "forbidden" || code.includes("forbidden")) {
          setError(t(lang, "staffUpgradeNeedOwner"));
        } else {
          setError(code);
        }
        return;
      }
      setMessage(t(lang, "staffUpgradeSent"));
      onSent();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md">
        <EnterpriseCard title={t(lang, "staffUpgradeTitle")}>
          <Body className="!text-sm">{t(lang, "staffUpgradeSub")}</Body>
          <p className="mt-2 text-sm font-black text-foreground">
            {staff.name} · {t(lang, `role_${staff.role}`)}
          </p>
          <div className="mt-3 space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t(lang, "staffInviteEmailPh")}
              className="w-full min-h-[48px] rounded-xl border border-border bg-card px-3 text-sm font-semibold"
              autoFocus
            />
            {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
            {message ? <p className="text-sm font-semibold text-emerald-700">{message}</p> : null}
            <div className="flex flex-wrap gap-2">
              <WakaButton
                variant="primary"
                disabled={busy || !eligible || !email.includes("@")}
                onClick={() => void submit()}
              >
                <Mail className="h-4 w-4" aria-hidden />
                {busy ? t(lang, "staffUpgradeWorking") : t(lang, "staffUpgradeSend")}
              </WakaButton>
              <WakaButton variant="secondary" disabled={busy} onClick={onClose}>
                {t(lang, "staffUpgradeClose")}
              </WakaButton>
            </div>
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <CloudUpload className="h-3.5 w-3.5" aria-hidden />
              {t(lang, "staffUpgradeKeepPin")}
            </p>
          </div>
        </EnterpriseCard>
      </div>
    </div>
  );
}
