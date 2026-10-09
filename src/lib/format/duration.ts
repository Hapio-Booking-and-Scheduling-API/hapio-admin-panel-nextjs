// ISO 8601 durations as accepted by Hapio:
// P[n]Y[n]M[n]DT[n]H[n]M[n]S or P[n]W, at most 4 digits per element, no decimals.

export interface DurationParts {
  years: number
  months: number
  weeks: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

export const EMPTY_DURATION: DurationParts = {
  years: 0,
  months: 0,
  weeks: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
}

const DURATION_RE =
  /^P(?:(\d{1,4})Y)?(?:(\d{1,4})M)?(?:(\d{1,4})W)?(?:(\d{1,4})D)?(?:T(?:(\d{1,4})H)?(?:(\d{1,4})M)?(?:(\d{1,4})S)?)?$/

export function parseDuration(value: string | null | undefined): DurationParts | null {
  if (!value) return null
  const match = DURATION_RE.exec(value.trim().toUpperCase())
  if (!match) return null
  // "P" or "PT" alone are invalid.
  if (match.slice(1).every((g) => g === undefined)) return null
  if (value.toUpperCase().endsWith("T")) return null
  const [, y, mo, w, d, h, mi, s] = match.map((g) => (g === undefined ? 0 : Number(g)))
  return { years: y, months: mo, weeks: w, days: d, hours: h, minutes: mi, seconds: s }
}

export function isValidDuration(value: string | null | undefined): boolean {
  const parts = parseDuration(value)
  if (!parts) return false
  // P[n]W cannot be combined with other elements.
  if (parts.weeks && (parts.years || parts.months || parts.days || parts.hours || parts.minutes || parts.seconds)) {
    return false
  }
  return true
}

export function isZeroDuration(value: string | null | undefined): boolean {
  const parts = parseDuration(value)
  return !!parts && Object.values(parts).every((n) => n === 0)
}

export function formatDuration(parts: Partial<DurationParts>): string {
  const p = { ...EMPTY_DURATION, ...parts }
  const clamp = (n: number) => Math.max(0, Math.min(9999, Math.floor(n || 0)))
  if (p.weeks && !p.years && !p.months && !p.days && !p.hours && !p.minutes && !p.seconds) {
    return `P${clamp(p.weeks)}W`
  }
  // Fold weeks into days when combined with other elements.
  const days = clamp(p.days + p.weeks * 7)
  let date = ""
  if (p.years) date += `${clamp(p.years)}Y`
  if (p.months) date += `${clamp(p.months)}M`
  if (days) date += `${days}D`
  let time = ""
  if (p.hours) time += `${clamp(p.hours)}H`
  if (p.minutes) time += `${clamp(p.minutes)}M`
  if (p.seconds) time += `${clamp(p.seconds)}S`
  if (!date && !time) return "PT0S"
  return `P${date}${time ? `T${time}` : ""}`
}

const UNITS: Array<[keyof DurationParts, string, string]> = [
  ["years", "year", "years"],
  ["months", "month", "months"],
  ["weeks", "week", "weeks"],
  ["days", "day", "days"],
  ["hours", "h", "h"],
  ["minutes", "min", "min"],
  ["seconds", "s", "s"],
]

/** "PT1H30M" → "1 h 30 min"; "PT0S" → "0 min"; invalid → the raw value. */
export function humanizeDuration(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  const parts = parseDuration(value)
  if (!parts) return value
  const out = UNITS.filter(([key]) => parts[key] > 0).map(
    ([key, one, many]) => `${parts[key]} ${parts[key] === 1 ? one : many}`
  )
  return out.length ? out.join(" ") : "0 min"
}

/** Approximate length in minutes (months = 30 days, years = 365 days). */
export function durationToMinutes(value: string | null | undefined): number | null {
  const p = parseDuration(value)
  if (!p) return null
  return (
    p.years * 525600 +
    p.months * 43200 +
    p.weeks * 10080 +
    p.days * 1440 +
    p.hours * 60 +
    p.minutes +
    p.seconds / 60
  )
}
