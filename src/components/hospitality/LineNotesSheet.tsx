import { useState } from "react";
import type { HospitalityCourse, Language } from "../../types";
import { t } from "../../lib/i18n";
import { ModalSheet } from "../layout/ModalSheet";
import { HOSPITALITY_COURSES, hospitalityCourseLabelKey } from "../../lib/productHospitalityRouting";

type Props = {
  lang: Language;
  open: boolean;
  lineName: string;
  initialNotes?: string | null;
  initialCourse?: HospitalityCourse | null;
  onClose: () => void;
  onSave: (input: { notes: string | null; course: HospitalityCourse | null }) => void;
};

export function LineNotesSheet({ lang, open, lineName, initialNotes, initialCourse, onClose, onSave }: Props) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [course, setCourse] = useState<HospitalityCourse | null>(initialCourse ?? null);

  if (!open) return null;

  return (
    <ModalSheet
      open
      onClose={onClose}
      zIndexClass="z-[66]"
      title={
        <div>
          <h2 className="text-lg font-black text-foreground">{t(lang, "lineNotesTitle")}</h2>
          <p className="text-sm font-bold text-muted-foreground">{lineName}</p>
        </div>
      }
      footer={
        <button
          type="button"
          onClick={() => onSave({ notes: notes.trim() || null, course })}
          className="min-h-14 w-full rounded-2xl bg-waka-600 text-lg font-black text-white"
        >
          {t(lang, "lineNotesSave")}
        </button>
      }
    >
      <label className="mb-4 block">
        <span className="text-sm font-bold text-muted-foreground">{t(lang, "lineNotesLabel")}</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={t(lang, "lineNotesPlaceholder")}
          className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm font-medium"
        />
      </label>
      <p className="mb-2 text-sm font-black text-foreground">{t(lang, "lineNotesCourse")}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCourse(null)}
          className={`min-h-10 rounded-xl border px-3 text-xs font-black ${course === null ? "border-waka-500 bg-waka-50" : "border-border"}`}
        >
          {t(lang, "lineNotesCourseDefault")}
        </button>
        {HOSPITALITY_COURSES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCourse(c)}
            className={`min-h-10 rounded-xl border px-3 text-xs font-black ${course === c ? "border-waka-500 bg-waka-50" : "border-border"}`}
          >
            {t(lang, hospitalityCourseLabelKey(c))}
          </button>
        ))}
      </div>
    </ModalSheet>
  );
}
