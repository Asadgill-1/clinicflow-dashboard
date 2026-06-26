export function fmtDateTime(iso: string | null | undefined, tz: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || undefined,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function fmtTime(iso: string | null | undefined, tz: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || undefined,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function fmtDate(iso: string | null | undefined, tz: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || undefined,
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function startOfDayInTZ(date: Date, tz: string): Date {
  // returns UTC instant for 00:00 in given tz on the same wall date as `date` (in tz)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  // Compose ISO in tz; approximate by using local offset
  // Use Date in UTC and let API filter use ISO range; we use a window from this Date to +24h.
  return new Date(`${y}-${m}-${d}T00:00:00`);
}
