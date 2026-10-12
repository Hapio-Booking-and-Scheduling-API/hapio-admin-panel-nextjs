// Hapio timestamps carry an explicit offset (`YYYY-MM-DDThh:mm:ss±hh:mm`), and
// dates/times are interpreted in the location's time zone. These helpers keep
// the panel working in "wall time" of a given zone.

import { TZDate } from "@date-fns/tz"
import { addDays, format, isValid, parseISO } from "date-fns"

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/

/** date-fns pattern of a Hapio timestamp: `YYYY-MM-DDThh:mm:ss±hh:mm`. */
export const HAPIO_TIMESTAMP_FORMAT = "yyyy-MM-dd'T'HH:mm:ssxxx"

/**
 * CLDR, and so V8/ICU, still uses the old names of these zones, while Hapio and the IANA
 * database use the current ones (Asia/Kolkata, Europe/Kyiv, …).
 */
const LEGACY_TIME_ZONES: Record<string, string> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
}

/** The current IANA name of a zone the runtime reports under a legacy alias. */
export function currentTimeZoneName(timeZone: string): string {
  return LEGACY_TIME_ZONES[timeZone] ?? timeZone
}

export function browserTimeZone(): string {
  try {
    return currentTimeZoneName(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return "UTC"
  }
}

/**
 * Wall time (`YYYY-MM-DDTHH:mm[:ss]`, e.g. from `<input type="datetime-local">`)
 * in `timeZone` → Hapio timestamp with offset.
 */
export function toHapioDateTime(wall: string, timeZone?: string | null): string {
  const m = WALL_RE.exec(wall)
  if (!m) return wall
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m
  const date = new TZDate(+y, +mo - 1, +d, +h, +mi, +s, timeZone || browserTimeZone())
  return format(date, HAPIO_TIMESTAMP_FORMAT)
}

/** An instant → Hapio timestamp, with the zone's offset at that instant. */
export function toHapioTimestamp(instant: Date | number, timeZone?: string | null): string {
  return format(new TZDate(instant.valueOf(), timeZone || browserTimeZone()), HAPIO_TIMESTAMP_FORMAT)
}

/** The date (`YYYY-MM-DD`) of an instant in a time zone. */
export function dateIn(instant: Date | number, timeZone?: string | null): string {
  return format(new TZDate(instant.valueOf(), timeZone || browserTimeZone()), "yyyy-MM-dd")
}

/** Hapio timestamp → wall time for `<input type="datetime-local">` (`YYYY-MM-DDTHH:mm`). */
export function toWallTime(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return ""
  if (!timeZone) {
    // The API already returns timestamps in the location's offset; keep its wall time.
    const m = WALL_RE.exec(iso)
    if (!m) return ""
    return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}`
  }
  const date = new TZDate(iso, timeZone)
  if (!isValid(date)) return ""
  return format(date, "yyyy-MM-dd'T'HH:mm")
}

/** Parse the wall-clock part of a timestamp, ignoring its offset (for display/layout). */
export function wallDate(iso: string): Date {
  const m = WALL_RE.exec(iso)
  if (!m) return parseISO(iso)
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
}

function offsetOf(iso: string): string {
  const m = /([+-]\d{2}:\d{2}|Z)$/.exec(iso)
  if (!m) return ""
  return m[1] === "Z" || m[1] === "+00:00" ? "UTC" : `UTC${m[1]}`
}

/**
 * Display a Hapio timestamp. Without `timeZone` the timestamp's own wall time
 * (which is the location's local time) is shown.
 */
export function formatDateTime(
  iso: string | null | undefined,
  options: { timeZone?: string | null; withOffset?: boolean; pattern?: string } = {}
): string {
  if (!iso) return "—"
  const pattern = options.pattern ?? "d MMM yyyy, HH:mm"
  const date = options.timeZone ? new TZDate(iso, options.timeZone) : wallDate(iso)
  if (!isValid(date)) return iso
  const text = format(date, pattern)
  if (!options.withOffset) return text
  const suffix = options.timeZone ? format(new TZDate(iso, options.timeZone), "'UTC'xxx") : offsetOf(iso)
  return suffix ? `${text} (${suffix})` : text
}

export function formatTime(iso: string | null | undefined, timeZone?: string | null) {
  return formatDateTime(iso, { timeZone, pattern: "HH:mm" })
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = wallDate(value)
  return isValid(date) ? format(date, "d MMM yyyy") : value
}

/** Today's date (`YYYY-MM-DD`) in a time zone. */
export function todayIn(timeZone?: string | null): string {
  return dateIn(Date.now(), timeZone)
}

/** Wall-time string `YYYY-MM-DDTHH:mm` for "now + days" at a given hour, in a zone. */
export function wallAt(daysFromToday: number, hour = 0, timeZone?: string | null): string {
  const today = new TZDate(Date.now(), timeZone || browserTimeZone())
  const d = addDays(today, daysFromToday)
  return `${format(d, "yyyy-MM-dd")}T${String(hour).padStart(2, "0")}:00`
}

/** Start/end of a range of days, as Hapio timestamps in a zone. */
export function dayRange(
  startDaysFromToday: number,
  numDays: number,
  timeZone?: string | null
): { from: string; to: string } {
  return {
    from: toHapioDateTime(wallAt(startDaysFromToday, 0, timeZone), timeZone),
    to: toHapioDateTime(wallAt(startDaysFromToday + numDays, 0, timeZone), timeZone),
  }
}

/** `hh:mm` or `hh:mm:ss` → `hh:mm:ss`. */
export function normalizeTime(value: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return value
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}`
}

/** `hh:mm:ss` → `hh:mm` (keeps seconds when non-zero). */
export function shortTime(value: string | null | undefined): string {
  if (!value) return ""
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!m) return value
  return m[3] && m[3] !== "00" ? value : `${m[1]}:${m[2]}`
}

export function isTimeString(value: string, allow24 = false): boolean {
  if (allow24 && value === "24:00:00") return true
  return /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)
}

let cachedZones: string[] | null = null
/** The runtime's time zones under their current IANA names, sorted, with UTC. */
export function timeZones(): string[] {
  if (cachedZones) return cachedZones
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.("timeZone")
    cachedZones = supported && supported.length ? [...new Set(supported.map(currentTimeZoneName))].sort() : ["UTC"]
  } catch {
    cachedZones = ["UTC"]
  }
  if (!cachedZones.includes("UTC")) cachedZones = ["UTC", ...cachedZones]
  return cachedZones
}
