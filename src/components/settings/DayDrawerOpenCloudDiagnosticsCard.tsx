import { useMemo } from "react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { usePosStore } from "../../store/usePosStore";
import { dateKeyKampala } from "../../lib/datesUg";
import { collectDayDrawerOpenDiagnostics } from "../../lib/dayDrawerOpenDiagnostics";

export function DayDrawerOpenCloudDiagnosticsCard({ lang }: { lang: Language }) {
  const dayDrawerOpens = usePosStore((s) => s.dayDrawerOpens);
  const shifts = usePosStore((s) => s.preferences.shifts ?? []);

  const todayKey = dateKeyKampala(new Date());

  const diag = useMemo(
    () => collectDayDrawerOpenDiagnostics(dayDrawerOpens, shifts, todayKey),
    [dayDrawerOpens, shifts, todayKey],
  );

  const issues = useMemo(() => {
    const list: string[] = [];
    if (diag.duplicateOpenCount > 0) {
      list.push(`${t(lang, "dayDrawerCloudDiagDuplicateOpens")}: ${diag.duplicateOpenCount}`);
    }
    if (diag.unsyncedCount > 0) {
      list.push(`${t(lang, "dayDrawerCloudDiagUnsynced")}: ${diag.unsyncedCount}`);
    }
    if (diag.conflictingDeviceCount > 1) {
      list.push(`${t(lang, "dayDrawerCloudDiagConflictingDevices")}: ${diag.conflictingDeviceCount}`);
    }
    if (diag.verificationMismatchCount > 0) {
      list.push(`${t(lang, "dayDrawerCloudDiagVerificationMismatch")}: ${diag.verificationMismatchCount}`);
    }
    return list;
  }, [diag, lang]);

  return (
    <article className="rounded-2xl border border-border/90 bg-card p-4 shadow-sm">
      <p className="text-base font-black text-foreground">{t(lang, "dayDrawerCloudDiagTitle")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{todayKey}</p>
      {diag.activeOpen ? (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
          <p className="font-black text-sky-950">
            {t(lang, "dayDrawerCloudDiagActiveOpen")}: UGX {diag.activeOpen.openingFloatUgx.toLocaleString()}
          </p>
          <p className="font-semibold text-sky-900">
            {diag.activeOpen.countedByLabel} · {diag.activeOpen.deviceId || "—"}
          </p>
          {diag.activeOpen.cloudSyncedAt ? (
            <p className="text-xs text-sky-800">
              {t(lang, "dayDrawerCloudDiagSynced")}: {new Date(diag.activeOpen.cloudSyncedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-border bg-muted px-3 py-2 text-sm font-semibold text-muted-foreground">
          {t(lang, "dayDrawerCloudDiagNoActiveOpen")}
        </p>
      )}
      {issues.length === 0 ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950">
          {t(lang, "cashDrawerDiagnosticsAllClear")}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {issues.map((issue) => (
            <li
              key={issue}
              className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950"
            >
              {issue}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
