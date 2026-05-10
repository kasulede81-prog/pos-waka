/** YYYY-MM-DD in Kampala for grouping “today” sales offline */
export function dateKeyKampala(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Calendar-day key at least `days` days before today (device local + Kampala formatting). */
export function dateKeyDaysAgoKampala(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return dateKeyKampala(d);
}
