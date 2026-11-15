/**
 * Time helpers for Mission Setup. All times are UTC. Julian Day uses the standard Unix-epoch offset
 * (JD 2440587.5 = 1970-01-01T00:00:00Z). UTC is treated as a uniform scale here (leap seconds ignored),
 * which is well below the 1 h ephemeris step.
 */

export const MS_PER_DAY = 86_400_000;
export const JD_UNIX_EPOCH = 2_440_587.5;

export function msToJulianDay(ms: number): number {
  return ms / MS_PER_DAY + JD_UNIX_EPOCH;
}

export function julianDayToMs(jd: number): number {
  // Rounded to the millisecond: a double at JD ~2.46e6 only resolves ~0.05 ms anyway.
  return Math.round((jd - JD_UNIX_EPOCH) * MS_PER_DAY);
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

export type ParsedTime = { ok: true; ms: number } | { ok: false; message: string };

/**
 * Parses an ISO 8601 date/time. A missing zone means UTC (mission planning is done in UTC), never
 * the browser's local time. Rejects impossible dates such as 2027-02-30.
 */
export function parseUtc(input: string): ParsedTime {
  const s = input.trim();
  const m = ISO_RE.exec(s);
  if (!m) {
    return { ok: false, message: "Use the format YYYY-MM-DD or YYYY-MM-DDTHH:MM (UTC)." };
  }
  const [, y, mo, d, h = "0", mi = "0", sec = "0", frac = "0", zone] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(sec);
  if (month < 1 || month > 12) return { ok: false, message: `Month ${month} does not exist.` };
  if (hour > 23 || minute > 59 || second > 59) {
    return { ok: false, message: "Time of day is out of range (00:00–23:59:59)." };
  }
  let ms = Date.UTC(year, month - 1, day, hour, minute, second, Number(frac.padEnd(3, "0")));
  const check = new Date(ms);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) {
    return { ok: false, message: `${y}-${mo}-${d} is not a real calendar date.` };
  }
  if (zone && zone.toUpperCase() !== "Z") {
    const sign = zone.startsWith("-") ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    const offsetMin = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
    ms -= sign * offsetMin * 60_000;
  }
  return { ok: true, ms };
}

/** "2027-01-15T06:00Z" style, minute precision. */
export function formatUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16) + "Z";
}
