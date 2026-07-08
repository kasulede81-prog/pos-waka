import { useState } from "react";
import type { Language, PharmacyPatientGender } from "../../../types";
import { t } from "../../../lib/i18n";
import { AppModalOverlay } from "../../layout/AppModalOverlay";
import { generatePatientCode } from "../../../lib/pharmacyPatientProfile";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
  onSave: (patientId: string) => void;
  addCustomer: (input: {
    name: string;
    phone: string;
    location: string;
    pharmacyProfile: {
      patientCode: string;
      allergies: string[];
      allergiesText?: string | null;
      dateOfBirth?: string | null;
      gender?: PharmacyPatientGender | null;
      notes: [];
      documents: [];
      chronicMedications: [];
    };
  }) => { id: string };
};

export function PharmacyNewPatientDrawer({ lang, open, onClose, onSave, addCustomer }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<PharmacyPatientGender | "">("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [allergiesText, setAllergiesText] = useState("");
  const [notes, setNotes] = useState("");

  if (!open) return null;

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const allergies = allergiesText
      .split(/[,;]+/)
      .map((a) => a.trim())
      .filter(Boolean);
    const row = addCustomer({
      name: n,
      phone: phone.trim(),
      location: "",
      pharmacyProfile: {
        patientCode: generatePatientCode(),
        allergies,
        allergiesText: allergiesText.trim() || null,
        dateOfBirth: dateOfBirth || null,
        gender: gender || null,
        notes: [],
        documents: [],
        chronicMedications: [],
      },
    });
    if (row.id !== "denied") {
      onSave(row.id);
      setName("");
      setPhone("");
      setGender("");
      setDateOfBirth("");
      setAllergiesText("");
      setNotes("");
      onClose();
    }
  };

  return (
    <AppModalOverlay className="z-[75] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="shrink-0 border-b border-stone-100 px-4 py-4">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDispenseNewPatientTitle")}</h2>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <label className="block text-xs font-bold text-stone-600">
            {t(lang, "pharmacyPatientNamePh")} *
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-stone-200 px-3 text-base font-semibold"
            />
          </label>
          <label className="block text-xs font-bold text-stone-600">
            {t(lang, "pharmacyPatientPhonePh")} *
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-stone-200 px-3 text-base font-semibold"
            />
          </label>
          <label className="block text-xs font-bold text-stone-600">
            {t(lang, "pharmacyPatientGender")}
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as PharmacyPatientGender | "")}
              className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-stone-200 px-3 text-base font-semibold"
            >
              <option value="">—</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block text-xs font-bold text-stone-600">
            {t(lang, "pharmacyPatientDob")}
            <input
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-stone-200 px-3 text-base font-semibold"
            />
          </label>
          <label className="block text-xs font-bold text-stone-600">
            {t(lang, "pharmacyPatientAllergies")}
            <input
              value={allergiesText}
              onChange={(e) => setAllergiesText(e.target.value)}
              placeholder={t(lang, "pharmacyDispenseAllergiesPh")}
              className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-stone-200 px-3 text-sm font-semibold"
            />
          </label>
          <label className="block text-xs font-bold text-stone-600">
            {t(lang, "pharmacyPatientNotes")}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-xl border-2 border-stone-200 px-3 py-2 text-sm font-semibold"
            />
          </label>
        </div>
        <div className="shrink-0 grid grid-cols-2 gap-2 border-t border-stone-100 p-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] rounded-2xl border-2 border-stone-200 font-black text-stone-800"
          >
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!name.trim()}
            className="min-h-[48px] rounded-2xl bg-teal-600 font-black text-white disabled:opacity-50"
          >
            {t(lang, "save")}
          </button>
        </div>
      </div>
    </AppModalOverlay>
  );
}
