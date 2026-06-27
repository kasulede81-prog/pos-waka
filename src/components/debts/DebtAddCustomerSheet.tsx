import { useEffect, useState, type FormEvent } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { AppModalOverlay } from "../layout/AppModalOverlay";

type Props = {
  lang: Language;
  open: boolean;
  addLabel: string;
  onClose: () => void;
  onSubmit: (name: string, phone: string) => void;
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed, phone.trim());
    onClose();
  };

  return (
    <AppModalOverlay className="z-[54] flex items-end bg-stone-900/40 backdrop-blur-[2px]" clearNav={false}>
      <button type="button" className="absolute inset-0" aria-label={t(lang, "cancel")} onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative z-[55] w-full rounded-t-[1.75rem] border border-stone-200 bg-white px-4 pb-[calc(var(--waka-bottom-nav-h)+var(--waka-safe-bottom)+1rem)] pt-3 shadow-2xl"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-200" aria-hidden />
        <p className="text-sm font-black text-stone-950">{t(lang, "debtsAddPerson")}</p>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(lang, "personNamePh")}
          required
          autoFocus
          className="mt-3 h-11 w-full rounded-xl border border-stone-200 px-3 text-sm font-semibold outline-none focus:border-waka-400 focus:ring-2 focus:ring-waka-200/80"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t(lang, "personPhonePh")}
          className="mt-2 h-11 w-full rounded-xl border border-stone-200 px-3 text-sm font-semibold outline-none focus:border-waka-400 focus:ring-2 focus:ring-waka-200/80"
        />

        <button
          type="submit"
          className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-waka-600 text-sm font-black text-white active:bg-waka-700"
        >
          {addLabel}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-stone-200 text-sm font-bold text-stone-600 active:bg-stone-50"
        >
          {t(lang, "cancel")}
        </button>
      </form>
    </AppModalOverlay>
  );
}
