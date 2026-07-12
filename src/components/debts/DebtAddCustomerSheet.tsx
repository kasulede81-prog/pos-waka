import { useEffect, useState, type FormEvent } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { EnterpriseTextField } from "../enterprise/EnterpriseTextField";
import { WakaButton } from "../ui/wakaPrimitives";

type Props = {
  lang: Language;
  open: boolean;
  addLabel: string;
  onClose: () => void;
  onSubmit: (name: string, phone: string) => boolean | Promise<boolean>;
};

export function DebtAddCustomerSheet({ lang, open, addLabel, onClose, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setPhone("");
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const ok = await onSubmit(trimmed, phone.trim());
    if (ok) onClose();
  };

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      clearNav={false}
      zIndexClass="z-[54]"
      title={t(lang, "debtsAddPerson")}
      footer={
        <div className="space-y-2">
          <WakaButton type="submit" form="debt-add-customer-form" className="w-full">
            {addLabel}
          </WakaButton>
          <WakaButton type="button" variant="secondary" className="w-full" onClick={onClose}>
            {t(lang, "cancel")}
          </WakaButton>
        </div>
      }
    >
      <form id="debt-add-customer-form" onSubmit={submit} className="space-y-3">
        <EnterpriseTextField
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(lang, "personNamePh")}
          required
          autoFocus
        />
        <EnterpriseTextField
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t(lang, "personPhonePh")}
        />
      </form>
    </ModalSheet>
  );
}
