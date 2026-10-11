#!/usr/bin/env node
// In-memory mock of the Hapio API v1 for local development and end-to-end tests.
//
//   npm run mock                        # http://127.0.0.1:4010/v1, seeded with demo data
//   MOCK_PORT=4011 npm run mock         # another port
//   MOCK_EMPTY=1 npm run mock           # start with no data
//   MOCK_RATE_LIMIT=5000 npm run mock   # requests per minute before 429 (default 600)
//   MOCK_NOW=2026-10-21T08:00:00+02:00  # freeze "now" (seed dates, timestamps, slot windows)
//   MOCK_SEED=1 npm run mock            # deterministic ids and random choices
//   MOCK_LOG=0 npm run mock             # don't log requests
//
// Point the admin panel at it with HAPIO_BASE_URL=http://127.0.0.1:4010/v1 and any
// non-empty HAPIO_API_TOKEN. Single file, no dependencies (Node 22+).
//
// Test helpers outside /v1 (no auth): GET /__health, POST /__reset[?empty=1&now=<ISO>&seed=<n>].

import http from "node:http"
import { randomUUID } from "node:crypto"

// ---------------------------------------------------------------------------
// Config & constants

const PORT = Number(process.env.MOCK_PORT) || 4010
const HOST = "127.0.0.1"
const BASE = "/v1"
// Requests per minute before 429 (headers always report it). Raise it for long e2e runs.
const RATE_LIMIT = Number(process.env.MOCK_RATE_LIMIT) || 600
const LOG = process.env.MOCK_LOG !== "0"

function parseNow(value, source) {
  if (!value) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) throw new Error(`${source}: not a valid ISO timestamp: ${value}`)
  return ms
}
function parseSeed(value, source) {
  if (value === undefined || value === null || value === "") return null
  const n = Number(value)
  if (!Number.isInteger(n)) throw new Error(`${source}: not an integer: ${value}`)
  return n
}
// Defaults for every reset; /__reset can override them for a single reset.
const BASE_NOW = parseNow(process.env.MOCK_NOW, "MOCK_NOW")
const BASE_SEED = parseSeed(process.env.MOCK_SEED, "MOCK_SEED")

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MAX_RANGE = 366 * DAY

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const STRATEGIES = ["randomize", "prioritize", "equalize"]
const SERVICE_TYPES = ["fixed", "flexible", "day"]
const OPERATORS = ["eq", "lt", "lte", "gt", "gte"]
const META_OPERATORS = [...OPERATORS, "seq", "slt", "slte", "sgt", "sgte"]
const INCLUSION = ["exclude", "include", "only"]
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BOOKING_FLAGS = [
  "ignore_schedule",
  "ignore_fully_booked",
  "ignore_bookable_slots",
  "ignore_booking_window",
  "ignore_cancelation_threshold",
]

// ---------------------------------------------------------------------------
// Errors

class HttpError extends Error {
  constructor(status, body, headers = {}) {
    super(body?.message ?? String(status))
    this.status = status
    this.body = body
    this.headers = headers
  }
}

const notFound = () => new HttpError(404, { message: "Not found." })
const invalid = (errors, extra = {}) =>
  new HttpError(422, { message: "The given data was invalid.", ...extra, errors })

// ---------------------------------------------------------------------------
// Small helpers

const isPlainObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x)
const pad = (n, w = 2) => String(n).padStart(w, "0")
const all = (preds) => {
  const ps = preds.filter(Boolean)
  return (rec) => ps.every((p) => p(rec))
}

// ---------------------------------------------------------------------------
// Clock & randomness (fixed when MOCK_NOW / MOCK_SEED are set, for repeatable tests)

let currentNow = BASE_NOW // null → real time
let currentSeed = BASE_SEED // null → crypto randomness
let rng = null

/** "Now" in ms, truncated to whole seconds. */
const clockNow = () => (currentNow ?? Math.floor(Date.now() / SECOND) * SECOND)

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = () => (rng ? rng() : Math.random())
function uuid() {
  if (!rng) return randomUUID()
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16))
  hex[12] = "4"
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  const h = hex.join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// Seeding uses a fake clock so created_at values are distinct and in the past. With a
// fixed "now", later writes tick forward one second each so timestamps stay unique and
// ordered without depending on the wall clock.
let seedClock = null
let stampClock = 0
function nowMs() {
  if (seedClock !== null) return (seedClock += MINUTE)
  if (currentNow !== null) return (stampClock = Math.max(stampClock + SECOND, currentNow))
  return clockNow()
}

// ---------------------------------------------------------------------------
// ISO 8601 durations

const DURATION_RE =
  /^P(?!$)(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?=\d)(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i

/** Duration string → milliseconds (years = 365 days, months = 30 days). null if invalid. */
function durationMs(value) {
  if (typeof value !== "string") return null
  const m = DURATION_RE.exec(value.trim())
  if (!m) return null
  const [y, mo, w, d, h, mi, s] = m.slice(1).map((x) => (x ? Number(x) : 0))
  return Math.round(
    (((y * 365 + mo * 30 + w * 7 + d) * 24 + h) * 60 + mi) * MINUTE + s * SECOND
  )
}

// ---------------------------------------------------------------------------
// Dates, times & time zones

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

const DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/i

/** `YYYY-MM-DDThh:mm:ss±hh:mm` (or Z) → epoch ms. null if invalid. */
function parseDateTime(value) {
  if (typeof value !== "string") return null
  // An unencoded "+" in a query string decodes to a space: "…T10:00:00 02:00".
  const s = value.trim().replace(/ (\d{2}:?\d{2})$/, "+$1")
  const m = DATETIME_RE.exec(s)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number)
  const sec = Number(m[6] ?? 0)
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || sec > 59) {
    return null
  }
  let offset = 0
  const off = m[7]
  if (off.toUpperCase() !== "Z") {
    const digits = off.slice(1).replace(":", "")
    offset = (off[0] === "-" ? -1 : 1) * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)))
  }
  return Date.UTC(y, mo - 1, d, h, mi, sec) - offset * MINUTE
}

function isDate(value) {
  if (typeof value !== "string") return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = m.slice(1).map(Number)
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
}

/** `hh:mm[:ss]` → `hh:mm:ss`; `24:00:00` only when allow24. null if invalid. */
function normTime(value, allow24 = false) {
  if (typeof value !== "string") return null
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!m) return null
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
  if (allow24 && h === 24 && mi === 0 && s === 0) return "24:00:00"
  if (h > 23 || mi > 59 || s > 59) return null
  return `${pad(h)}:${pad(mi)}:${pad(s)}`
}

const KNOWN_TIME_ZONES = new Set(Intl.supportedValuesOf("timeZone"))
function isValidTimeZone(tz) {
  if (typeof tz !== "string" || !tz) return false
  if (KNOWN_TIME_ZONES.has(tz) || tz === "UTC") return true
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const offsetFormatters = new Map()
const offsetCache = new Map()

/** UTC offset of `tz` at instant `ms`, in minutes. */
function tzOffset(ms, tz) {
  if (!tz || tz === "UTC") return 0
  // Offsets only change on quarter-hour boundaries, so cache per 15 minutes.
  const key = `${tz}|${Math.floor(ms / (15 * MINUTE))}`
  const cached = offsetCache.get(key)
  if (cached !== undefined) return cached
  let fmt = offsetFormatters.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    offsetFormatters.set(tz, fmt)
  }
  const name = fmt.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? ""
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name)
  const offset = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0
  if (offsetCache.size > 100_000) offsetCache.clear()
  offsetCache.set(key, offset)
  return offset
}

/** Days since 1970-01-01 for a `YYYY-MM-DD` string. */
const dayNumOf = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY
const dateOfDayNum = (n) => new Date(n * DAY).toISOString().slice(0, 10)
/** 0 = Monday … 6 = Sunday. */
const weekdayIdx = (n) => (((n + 3) % 7) + 7) % 7

/** Wall-clock time in `tz` → epoch ms. */
function wallToMs(dayNum, time, tz) {
  if (time === "24:00:00") return wallToMs(dayNum + 1, "00:00:00", tz)
  const [h, mi, s] = time.split(":").map(Number)
  const guess = dayNum * DAY + ((h * 60 + mi) * 60 + s) * SECOND
  const first = guess - tzOffset(guess, tz) * MINUTE
  const second = tzOffset(first, tz)
  return guess - second * MINUTE
}

/** Epoch ms → local day number in `tz`. */
const localDayNum = (ms, tz) => Math.floor((ms + tzOffset(ms, tz) * MINUTE) / DAY)

/** Epoch ms → `YYYY-MM-DDThh:mm:ss±hh:mm` in `tz`. */
function fmt(ms, tz = "UTC") {
  if (ms === null || ms === undefined) return null
  const off = tzOffset(ms, tz)
  const d = new Date(ms + off * MINUTE)
  const abs = Math.abs(off)
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `${off < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}
const fmtUtc = (ms) => fmt(ms, "UTC")

// ---------------------------------------------------------------------------
// Time spans: { start, end } in epoch ms

function mergeSpans(spans) {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)
  const out = []
  for (const s of sorted) {
    const last = out.at(-1)
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else out.push({ ...s })
  }
  return out
}

function subtractSpans(spans, cuts) {
  let out = spans.map((s) => ({ ...s }))
  for (const c of cuts) {
    const next = []
    for (const s of out) {
      if (c.end <= s.start || c.start >= s.end) {
        next.push(s)
        continue
      }
      if (c.start > s.start) next.push({ ...s, end: c.start })
      if (c.end < s.end) next.push({ ...s, start: c.end })
    }
    out = next
  }
  return out
}

const clipSpans = (spans, from, to) =>
  spans
    .filter((s) => s.end > from && s.start < to)
    .map((s) => ({ ...s, start: Math.max(s.start, from), end: Math.min(s.end, to) }))

// ---------------------------------------------------------------------------
// Store

let db

function emptyDb() {
  return {
    project: null,
    locations: new Map(),
    resources: new Map(),
    services: new Map(),
    resourceServices: [],
    scheduleBlocks: new Map(),
    recurringSchedules: new Map(),
    recurringScheduleBlocks: new Map(),
    bookings: new Map(),
    bookingGroups: new Map(),
  }
}

function stamp(rec, existing) {
  const now = nowMs()
  rec.created_at = existing?.created_at ?? now
  rec.updated_at = now
  return rec
}

const associatedResources = (serviceId) =>
  db.resourceServices
    .filter((a) => a.service_id === serviceId)
    .map((a) => db.resources.get(a.resource_id))
    .filter(Boolean)

const bookingsOfGroup = (groupId) =>
  [...db.bookings.values()].filter((b) => b.booking_group_id === groupId)

// ---------------------------------------------------------------------------
// Serializers

function serProject() {
  const p = db.project
  return {
    id: p.id,
    name: p.name,
    enabled: p.enabled,
    created_at: fmtUtc(p.created_at),
    updated_at: fmtUtc(p.updated_at),
  }
}

function serLocation(l) {
  return {
    id: l.id,
    name: l.name,
    time_zone: l.time_zone,
    resource_selection_strategy: l.resource_selection_strategy,
    resource_selection_priority: l.resource_selection_priority ?? [],
    metadata: l.metadata,
    protected_metadata: l.protected_metadata,
    enabled: l.enabled,
    created_at: fmtUtc(l.created_at),
    updated_at: fmtUtc(l.updated_at),
  }
}

function serResource(r) {
  return {
    id: r.id,
    name: r.name,
    max_simultaneous_bookings: r.max_simultaneous_bookings,
    metadata: r.metadata,
    protected_metadata: r.protected_metadata,
    enabled: r.enabled,
    created_at: fmtUtc(r.created_at),
    updated_at: fmtUtc(r.updated_at),
  }
}

const SERVICE_COMMON = [
  "buffer_time_before",
  "buffer_time_after",
  "booking_window_start",
  "booking_window_end",
  "cancelation_threshold",
  "metadata",
  "protected_metadata",
  "enabled",
]
const SERVICE_TYPE_FIELDS = {
  fixed: ["duration", "bookable_interval"],
  flexible: ["min_duration", "max_duration", "default_duration", "duration_step", "bookable_interval"],
  day: ["start_time", "end_time", "min_days", "max_days", "default_days"],
}

function serService(s) {
  const out = { id: s.id, name: s.name, type: s.type, price: s.price }
  for (const k of SERVICE_TYPE_FIELDS[s.type]) out[k] = s[k] ?? null
  for (const k of SERVICE_COMMON) out[k] = s[k]
  out.created_at = fmtUtc(s.created_at)
  out.updated_at = fmtUtc(s.updated_at)
  return out
}

const serAssociation = (a) => ({
  resource_id: a.resource_id,
  service_id: a.service_id,
  created_at: fmtUtc(a.created_at),
})

function serScheduleBlock(b) {
  const loc = db.locations.get(b.location_id)
  const tz = loc?.time_zone ?? "UTC"
  return {
    id: b.id,
    location: loc ? serLocation(loc) : null,
    starts_at: fmt(b.starts_at, tz),
    ends_at: fmt(b.ends_at, tz),
    is_available: b.is_available,
    created_at: fmtUtc(b.created_at),
    updated_at: fmtUtc(b.updated_at),
  }
}

function serRecurringSchedule(rs) {
  const loc = db.locations.get(rs.location_id)
  return {
    id: rs.id,
    location: loc ? serLocation(loc) : null,
    start_date: rs.start_date,
    end_date: rs.end_date,
    interval: rs.interval,
    created_at: fmtUtc(rs.created_at),
    updated_at: fmtUtc(rs.updated_at),
  }
}

const serRecurringScheduleBlock = (b) => ({
  id: b.id,
  weekday: b.weekday,
  start_time: b.start_time,
  end_time: b.end_time,
  created_at: fmtUtc(b.created_at),
  updated_at: fmtUtc(b.updated_at),
})

const serGroupEmbedded = (g) => ({
  id: g.id,
  metadata: g.metadata,
  protected_metadata: g.protected_metadata,
  created_at: fmtUtc(g.created_at),
  updated_at: fmtUtc(g.updated_at),
})

function serBooking(b, withGroup = true) {
  const resource = b.resource_id ? db.resources.get(b.resource_id) : null
  const service = b.service_id ? db.services.get(b.service_id) : null
  const location = b.location_id ? db.locations.get(b.location_id) : null
  const tz = location?.time_zone ?? "UTC"
  const out = {
    id: b.id,
    resource: resource ? serResource(resource) : null,
    service: service ? serService(service) : null,
    location: location ? serLocation(location) : null,
  }
  if (withGroup) {
    const group = b.booking_group_id ? db.bookingGroups.get(b.booking_group_id) : null
    out.booking_group = group ? serGroupEmbedded(group) : null
  }
  Object.assign(out, {
    price: b.price,
    metadata: b.metadata,
    protected_metadata: b.protected_metadata,
    is_temporary: b.is_temporary,
    is_canceled: b.is_canceled,
    starts_at: fmt(b.starts_at, tz),
    ends_at: fmt(b.ends_at, tz),
    buffer_starts_at: fmt(b.buffer_starts_at, tz),
    buffer_ends_at: fmt(b.buffer_ends_at, tz),
    finalized_at: fmtUtc(b.finalized_at),
    canceled_at: fmtUtc(b.canceled_at),
    created_at: fmtUtc(b.created_at),
    updated_at: fmtUtc(b.updated_at),
  })
  return out
}

const serBookingGroup = (g) => ({
  id: g.id,
  bookings: bookingsOfGroup(g.id).map((b) => serBooking(b, false)),
  metadata: g.metadata,
  protected_metadata: g.protected_metadata,
  created_at: fmtUtc(g.created_at),
  updated_at: fmtUtc(g.updated_at),
})

// ---------------------------------------------------------------------------
// Body validation (Laravel-style messages)

const ABSENT = Symbol("absent")

function validator(src, prefix = "") {
  const errors = {}
  const v = {
    src: isPlainObject(src) ? src : {},
    errors,
    has: (f) => Object.hasOwn(v.src, f) && v.src[f] !== undefined,
    fail(f, message) {
      const key = prefix + f
      const label = prefix ? key : f.replaceAll("_", " ")
      ;(errors[key] ??= []).push(message.replaceAll(":attr", label))
    },
    get ok() {
      return Object.keys(errors).length === 0
    },
    check() {
      if (!v.ok) throw invalid(errors)
    },
  }
  return v
}

/** Reads one field. Returns ABSENT when missing or invalid (the error is recorded). */
function field(v, f, { required = false, present = false, nullable = false, parse = (x) => ({ value: x }) } = {}) {
  if (!v.has(f)) {
    if (required) v.fail(f, "The :attr field is required.")
    else if (present) v.fail(f, "The :attr field must be present.")
    return ABSENT
  }
  let raw = v.src[f]
  if (raw === "") raw = null // Laravel's ConvertEmptyStringsToNull
  if (raw === null) {
    if (required) {
      v.fail(f, "The :attr field is required.")
      return ABSENT
    }
    if (nullable) return null
    v.fail(f, "The :attr field must not be null.")
    return ABSENT
  }
  const result = parse(raw)
  if (result.error) {
    v.fail(f, result.error)
    return ABSENT
  }
  return result.value
}

const P = {
  string: (max = 255) => (x) =>
    typeof x !== "string"
      ? { error: "The :attr must be a string." }
      : x.length > max
        ? { error: `The :attr must not be greater than ${max} characters.` }
        : { value: x },
  bool: (x) => {
    if (x === true || x === 1 || x === "1" || x === "true") return { value: true }
    if (x === false || x === 0 || x === "0" || x === "false") return { value: false }
    return { error: "The :attr field must be true or false." }
  },
  int: (min, max) => (x) => {
    const n = typeof x === "string" && /^-?\d+$/.test(x) ? Number(x) : x
    if (!Number.isInteger(n)) return { error: "The :attr must be an integer." }
    if (min !== undefined && n < min) return { error: `The :attr must be at least ${min}.` }
    if (max !== undefined && n > max) return { error: `The :attr must not be greater than ${max}.` }
    return { value: n }
  },
  enum: (list) => (x) => (list.includes(x) ? { value: x } : { error: "The selected :attr is invalid." }),
  exists: (map) => (x) =>
    typeof x === "string" && map.has(x) ? { value: x } : { error: "The selected :attr is invalid." },
  uuidList: (x) =>
    Array.isArray(x) && x.every((i) => typeof i === "string" && UUID_RE.test(i))
      ? { value: [...new Set(x)] }
      : { error: "The :attr must be an array of UUIDs." },
  dateTime: (x) => {
    const ms = parseDateTime(x)
    return ms === null ? { error: "The :attr must match the format Y-m-d\\TH:i:sP." } : { value: ms }
  },
  date: (x) => (isDate(x) ? { value: x } : { error: "The :attr must match the format Y-m-d." }),
  time: (allow24 = false) => (x) => {
    const t = normTime(x, allow24)
    return t ? { value: t } : { error: "The :attr must match the format H:i:s." }
  },
  duration: (x) =>
    durationMs(x) === null
      ? { error: "The :attr must be a valid ISO 8601 duration." }
      : { value: x.trim().toUpperCase() },
  positiveDuration: (x) => {
    const ms = durationMs(x)
    if (ms === null) return { error: "The :attr must be a valid ISO 8601 duration." }
    if (ms <= 0) return { error: "The :attr must be a duration greater than zero." }
    return { value: x.trim().toUpperCase() }
  },
  price: (x) => {
    const s = typeof x === "number" ? String(x) : x
    if (typeof s !== "string" || !/^\d+(\.\d+)?$/.test(s.trim())) {
      return { error: "The :attr must be a non-negative decimal number." }
    }
    return { value: Number(s).toFixed(3) }
  },
  metadata: (x) => {
    if (isPlainObject(x)) return { value: x }
    if (Array.isArray(x) && x.length === 0) return { value: {} }
    return { error: "The :attr must be an object." }
  },
  timeZone: (x) => (isValidTimeZone(x) ? { value: x } : { error: "The :attr must be a valid timezone." }),
  dayTime: (allow24) => (x) => {
    if (typeof x === "string") {
      const t = normTime(x, allow24)
      return t ? { value: t } : { error: "The :attr must match the format H:i:s." }
    }
    if (isPlainObject(x)) {
      const out = {}
      for (const day of WEEKDAYS) {
        const t = normTime(x[day], allow24)
        if (!t) return { error: `The :attr.${day} must match the format H:i:s.` }
        out[day] = t
      }
      return { value: out }
    }
    return { error: "The :attr must be a time or an object with a time for every weekday." }
  },
}

// Picks the new value, the existing one (PATCH) or the default (POST/PUT).
const merger = (existing, patch) => (value, key, fallback = null) =>
  value !== ABSENT ? value : patch ? existing[key] : fallback

// ---------------------------------------------------------------------------
// Query parsing & list filters

const decode = (s) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "))
  } catch {
    return s
  }
}

function parseQuery(raw) {
  const entries = []
  for (const part of raw.split("&")) {
    if (!part) continue
    const i = part.indexOf("=")
    const key = decode(i < 0 ? part : part.slice(0, i))
    const value = i < 0 ? "" : decode(part.slice(i + 1))
    const m = /^([^[]+)((?:\[[^\]]*\])*)$/.exec(key)
    if (!m) entries.push({ base: key, path: [], value })
    else entries.push({ base: m[1], path: [...m[2].matchAll(/\[([^\]]*)\]/g)].map((x) => x[1]), value })
  }
  return {
    raw,
    entries,
    get(name) {
      const e = entries.findLast((x) => x.base === name && x.path.length === 0)
      return e && e.value !== "" ? e.value : undefined
    },
    has: (name) => entries.some((x) => x.base === name),
  }
}

function compareOp(a, b, op) {
  switch (op) {
    case "eq":
      return a === b
    case "lt":
      return a < b
    case "lte":
      return a <= b
    case "gt":
      return a > b
    case "gte":
      return a >= b
  }
  return false
}

function parseFilterValue(raw, kind, key) {
  switch (kind) {
    case "number": {
      const n = Number(raw)
      if (raw === "" || !Number.isFinite(n)) throw invalid({ [key]: [`The ${key} must be a number.`] })
      return n
    }
    case "datetime": {
      const ms = parseDateTime(raw)
      if (ms === null) throw invalid({ [key]: [`The ${key} must match the format Y-m-d\\TH:i:sP.`] })
      return ms
    }
    case "date":
      if (!isDate(raw)) throw invalid({ [key]: [`The ${key} must match the format Y-m-d.`] })
      return raw
    case "time": {
      const t = normTime(raw, true)
      if (!t) throw invalid({ [key]: [`The ${key} must match the format H:i:s.`] })
      return t
    }
    default:
      return raw
  }
}

/** `key[op]=value` (and `key=value` as eq). */
function opPredicate(q, name, kind, get) {
  const ops = []
  for (const e of q.entries) {
    if (e.base !== name) continue
    if (e.path.length > 1) throw invalid({ [name]: [`The ${name} filter is invalid.`] })
    const op = e.path[0] ?? "eq"
    if (!OPERATORS.includes(op)) {
      throw invalid({ [`${name}[${op}]`]: [`The operator ${op} is not supported.`] })
    }
    if (e.path.length === 0 && e.value === "") continue
    ops.push([op, parseFilterValue(e.value, kind, `${name}[${op}]`)])
  }
  if (!ops.length) return null
  return (rec) => {
    const val = get(rec)
    if (val === null || val === undefined) return false
    return ops.every(([op, fv]) => compareOp(val, fv, op))
  }
}

function metaCompare(actual, op, value) {
  if (op.startsWith("s")) {
    const a = actual === null ? "null" : typeof actual === "object" ? JSON.stringify(actual) : String(actual)
    return compareOp(a, value, op.slice(1))
  }
  if (typeof actual === "boolean") {
    const b = value === "true" || value === "1" ? true : value === "false" || value === "0" ? false : null
    return op === "eq" && b === actual
  }
  if (actual === null) return op === "eq" && value === "null"
  if (typeof actual === "object") return compareOp(JSON.stringify(actual), value, op)
  const an = Number(actual)
  const vn = Number(value)
  if (actual !== "" && value !== "" && Number.isFinite(an) && Number.isFinite(vn)) return compareOp(an, vn, op)
  return compareOp(String(actual), value, op)
}

/** `metadata[prop->nested][op]=value` (and `metadata[prop]=value` as eq). */
function metaPredicate(q, name, get) {
  const items = []
  for (const e of q.entries) {
    if (e.base !== name) continue
    if (e.path.length < 1 || e.path.length > 2 || !e.path[0]) {
      throw invalid({ [name]: [`The ${name} filter is invalid.`] })
    }
    const op = e.path[1] ?? "eq"
    if (!META_OPERATORS.includes(op)) {
      throw invalid({ [`${name}[${e.path[0]}][${op}]`]: [`The operator ${op} is not supported.`] })
    }
    items.push({ path: e.path[0].split("->").map((p) => p.trim()), op, value: e.value })
  }
  if (!items.length) return null
  return (rec) =>
    items.every(({ path, op, value }) => {
      let cur = get(rec)
      for (const k of path) {
        if (cur === null || typeof cur !== "object") return false
        cur = cur[k]
      }
      return cur !== undefined && metaCompare(cur, op, value)
    })
}

function inclusion(q, name) {
  const value = q.get(name) ?? "exclude"
  if (!INCLUSION.includes(value)) throw invalid({ [name]: [`The selected ${name} is invalid.`] })
  return (flag) => (value === "include" ? true : value === "only" ? flag : !flag)
}

function optDateTimeParam(q, name) {
  const raw = q.get(name)
  if (raw === undefined) return null
  return parseFilterValue(raw, "datetime", name)
}

function equalsParam(q, name, get) {
  const value = q.get(name)
  return value === undefined ? null : (rec) => get(rec) === value
}

const timestampPredicates = (q, prefix = "") => [
  opPredicate(q, `${prefix}created_at`, "datetime", (r) => r.created_at),
  opPredicate(q, `${prefix}updated_at`, "datetime", (r) => r.updated_at),
]

const metadataPredicates = (q, prefix = "") => [
  metaPredicate(q, `${prefix}metadata`, (r) => r.metadata),
  metaPredicate(q, `${prefix}protected_metadata`, (r) => r.protected_metadata),
]

// ---------------------------------------------------------------------------
// Sorting & pagination

function compareValues(a, b) {
  const an = a === null || a === undefined
  const bn = b === null || b === undefined
  if (an || bn) return an && bn ? 0 : an ? 1 : -1
  if (typeof a === "number" && typeof b === "number") return a - b
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b)
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

function applySort(items, q, fields, getters = {}) {
  const raw = q.get("sort")
  if (!raw) return items
  const keys = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      let [name, dir = "asc"] = part.split(".")
      if (name.startsWith("-")) {
        name = name.slice(1)
        dir = "desc"
      }
      dir = dir.toLowerCase()
      if (!fields.includes(name) || !["asc", "desc"].includes(dir)) {
        throw invalid({ sort: [`The sort value "${part}" is invalid. Allowed fields: ${fields.join(", ")}.`] })
      }
      const get = getters[name]
        ? getters[name]
        : name === "price"
          ? (r) => (r.price === null ? null : Number(r.price))
          : name === "weekday"
            ? (r) => WEEKDAYS.indexOf(r.weekday)
            : (r) => r[name.replace(/^group_/, "")]
      return { get, mul: dir === "desc" ? -1 : 1 }
    })
  return [...items].sort((a, b) => {
    for (const k of keys) {
      const c = compareValues(k.get(a), k.get(b))
      if (c) return c * k.mul
    }
    return 0
  })
}

function intParam(q, name, fallback, min, max) {
  const raw = q.get(name)
  if (raw === undefined) return fallback
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(n) || n < min || (max !== undefined && n > max)) {
    const msg =
      max === undefined ? `The ${name.replace("_", " ")} must be at least ${min}.` : `The ${name.replace("_", " ")} must be between ${min} and ${max}.`
    throw invalid({ [name]: [msg] })
  }
  return n
}

function paginate(ctx, items, serialize) {
  const page = intParam(ctx.query, "page", 1, 1)
  const perPage = intParam(ctx.query, "per_page", 100, 1, 100)
  const total = items.length
  const lastPage = Math.max(1, Math.ceil(total / perPage))
  const offset = (page - 1) * perPage
  const slice = items.slice(offset, offset + perPage)
  const path = `${ctx.origin}${ctx.pathname}`
  const rest = ctx.query.raw
    .split("&")
    .filter((p) => p && !/^page=/.test(p))
    .join("&")
  const link = (n) => `${path}?${rest ? `${rest}&` : ""}page=${n}`
  return {
    data: slice.map(serialize),
    links: {
      first: link(1),
      last: link(lastPage),
      prev: page > 1 ? link(page - 1) : null,
      next: page < lastPage ? link(page + 1) : null,
    },
    meta: {
      current_page: page,
      from: slice.length ? offset + 1 : null,
      last_page: lastPage,
      path,
      per_page: perPage,
      to: slice.length ? offset + slice.length : null,
      total,
    },
  }
}

// ---------------------------------------------------------------------------
// Builders: validate a request body and return a full record (throws 422)

function buildLocation(body, existing, mode) {
  const v = validator(body)
  const patch = mode === "patch"
  const f = {
    name: field(v, "name", { required: !patch, parse: P.string(100) }),
    time_zone: field(v, "time_zone", { required: !patch, parse: P.timeZone }),
    resource_selection_strategy: field(v, "resource_selection_strategy", {
      required: !patch,
      parse: P.enum(STRATEGIES),
    }),
    resource_selection_priority: field(v, "resource_selection_priority", { nullable: true, parse: P.uuidList }),
    metadata: field(v, "metadata", { nullable: true, parse: P.metadata }),
    protected_metadata: field(v, "protected_metadata", { nullable: true, parse: P.metadata }),
    enabled: field(v, "enabled", { parse: P.bool }),
  }
  v.check()
  const pick = merger(existing, patch)
  return stamp(
    {
      id: existing?.id ?? uuid(),
      name: pick(f.name, "name"),
      time_zone: pick(f.time_zone, "time_zone"),
      resource_selection_strategy: pick(f.resource_selection_strategy, "resource_selection_strategy"),
      resource_selection_priority: pick(f.resource_selection_priority, "resource_selection_priority", []) ?? [],
      metadata: pick(f.metadata, "metadata"),
      protected_metadata: pick(f.protected_metadata, "protected_metadata"),
      enabled: pick(f.enabled, "enabled", true),
    },
    existing
  )
}

function buildResource(body, existing, mode) {
  const v = validator(body)
  const patch = mode === "patch"
  const f = {
    name: field(v, "name", { required: !patch, parse: P.string(100) }),
    max_simultaneous_bookings: field(v, "max_simultaneous_bookings", { nullable: true, parse: P.int(1) }),
    metadata: field(v, "metadata", { nullable: true, parse: P.metadata }),
    protected_metadata: field(v, "protected_metadata", { nullable: true, parse: P.metadata }),
    enabled: field(v, "enabled", { parse: P.bool }),
  }
  v.check()
  const pick = merger(existing, patch)
  return stamp(
    {
      id: existing?.id ?? uuid(),
      name: pick(f.name, "name"),
      max_simultaneous_bookings: pick(f.max_simultaneous_bookings, "max_simultaneous_bookings", 1),
      metadata: pick(f.metadata, "metadata"),
      protected_metadata: pick(f.protected_metadata, "protected_metadata"),
      enabled: pick(f.enabled, "enabled", true),
    },
    existing
  )
}

const SERVICE_DEFAULTS = {
  price: null,
  buffer_time_before: "PT0S",
  buffer_time_after: "PT0S",
  booking_window_start: "PT0S",
  booking_window_end: null,
  cancelation_threshold: "PT0S",
  metadata: null,
  protected_metadata: null,
  enabled: true,
  bookable_interval: null,
  max_duration: null,
  default_duration: null,
  max_days: null,
  default_days: null,
}

function buildService(body, existing, mode) {
  const v = validator(body)
  const patch = mode === "patch"
  const type = field(v, "type", { required: !patch, parse: P.enum(SERVICE_TYPES) })
  const effectiveType = type !== ABSENT ? type : existing?.type
  const typeChanged = patch && type !== ABSENT && type !== existing.type
  const requireTypeFields = !patch || typeChanged

  const common = {
    name: field(v, "name", { required: !patch, parse: P.string(100) }),
    price: field(v, "price", { nullable: true, parse: P.price }),
    buffer_time_before: field(v, "buffer_time_before", { parse: P.duration }),
    buffer_time_after: field(v, "buffer_time_after", { parse: P.duration }),
    booking_window_start: field(v, "booking_window_start", { parse: P.duration }),
    booking_window_end: field(v, "booking_window_end", { nullable: true, parse: P.duration }),
    cancelation_threshold: field(v, "cancelation_threshold", { parse: P.duration }),
    metadata: field(v, "metadata", { nullable: true, parse: P.metadata }),
    protected_metadata: field(v, "protected_metadata", { nullable: true, parse: P.metadata }),
    enabled: field(v, "enabled", { parse: P.bool }),
  }

  const req = { required: requireTypeFields }
  const opt = { nullable: true }
  const typed = {}
  if (effectiveType === "fixed") {
    typed.duration = field(v, "duration", { ...req, parse: P.positiveDuration })
    typed.bookable_interval = field(v, "bookable_interval", { ...opt, parse: P.positiveDuration })
  } else if (effectiveType === "flexible") {
    typed.min_duration = field(v, "min_duration", { ...req, parse: P.positiveDuration })
    typed.max_duration = field(v, "max_duration", { ...opt, parse: P.positiveDuration })
    typed.default_duration = field(v, "default_duration", { ...opt, parse: P.positiveDuration })
    typed.duration_step = field(v, "duration_step", { ...req, parse: P.positiveDuration })
    typed.bookable_interval = field(v, "bookable_interval", { ...opt, parse: P.positiveDuration })
  } else if (effectiveType === "day") {
    typed.start_time = field(v, "start_time", { ...req, parse: P.dayTime(false) })
    typed.end_time = field(v, "end_time", { ...req, parse: P.dayTime(true) })
    typed.min_days = field(v, "min_days", { ...req, parse: P.int(1) })
    typed.max_days = field(v, "max_days", { ...opt, parse: P.int(1) })
    typed.default_days = field(v, "default_days", { ...opt, parse: P.int(1) })
  }
  v.check()

  const rec = { id: existing?.id ?? uuid(), type: effectiveType }
  for (const [k, value] of Object.entries(common)) {
    rec[k] = value !== ABSENT ? value : patch ? existing[k] : SERVICE_DEFAULTS[k]
  }
  for (const [k, value] of Object.entries(typed)) {
    rec[k] = value !== ABSENT ? value : patch && !typeChanged ? existing[k] : (SERVICE_DEFAULTS[k] ?? null)
  }

  if (rec.type === "flexible") {
    const min = durationMs(rec.min_duration)
    const max = rec.max_duration ? durationMs(rec.max_duration) : Infinity
    if (max < min) v.fail("max_duration", "The :attr must be greater than or equal to the min duration.")
    if (rec.default_duration) {
      const def = durationMs(rec.default_duration)
      if (def < min || def > max) v.fail("default_duration", "The :attr must be between the min and max duration.")
    }
  } else if (rec.type === "day") {
    if (rec.max_days !== null && rec.max_days < rec.min_days) {
      v.fail("max_days", "The :attr must be greater than or equal to min days.")
    }
    if (rec.default_days !== null && (rec.default_days < rec.min_days || (rec.max_days !== null && rec.default_days > rec.max_days))) {
      v.fail("default_days", "The :attr must be between min days and max days.")
    }
  }
  v.check()
  return stamp(rec, existing)
}

function buildScheduleBlock(body, existing, mode, resource) {
  const v = validator(body)
  const patch = mode === "patch"
  const f = {
    location_id: field(v, "location_id", { required: !patch, parse: P.exists(db.locations) }),
    starts_at: field(v, "starts_at", { required: !patch, parse: P.dateTime }),
    ends_at: field(v, "ends_at", { required: !patch, parse: P.dateTime }),
    is_available: field(v, "is_available", { parse: P.bool }),
  }
  v.check()
  const pick = merger(existing, patch)
  const rec = {
    id: existing?.id ?? uuid(),
    resource_id: resource.id,
    location_id: pick(f.location_id, "location_id"),
    starts_at: pick(f.starts_at, "starts_at"),
    ends_at: pick(f.ends_at, "ends_at"),
    is_available: pick(f.is_available, "is_available", true),
  }
  if (rec.ends_at <= rec.starts_at) v.fail("ends_at", "The :attr must be a date after starts at.")
  v.check()
  const overlapping = [...db.scheduleBlocks.values()].some(
    (b) =>
      b.id !== rec.id &&
      b.resource_id === rec.resource_id &&
      b.location_id === rec.location_id &&
      b.is_available === rec.is_available &&
      b.starts_at < rec.ends_at &&
      b.ends_at > rec.starts_at
  )
  if (overlapping) v.fail("starts_at", "The schedule block overlaps with another schedule block.")
  v.check()
  return stamp(rec, existing)
}

function buildRecurringSchedule(body, existing, mode, resource) {
  const v = validator(body)
  const patch = mode === "patch"
  const f = {
    location_id: field(v, "location_id", { required: !patch, parse: P.exists(db.locations) }),
    start_date: field(v, "start_date", { required: !patch, parse: P.date }),
    end_date: field(v, "end_date", { nullable: true, parse: P.date }),
    interval: field(v, "interval", { parse: P.int(1, 52) }),
  }
  v.check()
  const pick = merger(existing, patch)
  const rec = {
    id: existing?.id ?? uuid(),
    resource_id: resource.id,
    location_id: pick(f.location_id, "location_id"),
    start_date: pick(f.start_date, "start_date"),
    end_date: pick(f.end_date, "end_date"),
    interval: pick(f.interval, "interval", 1),
  }
  if (rec.end_date !== null && rec.end_date < rec.start_date) {
    v.fail("end_date", "The :attr must be a date after or equal to start date.")
  }
  v.check()
  return stamp(rec, existing)
}

function buildRecurringScheduleBlock(body, existing, mode, schedule) {
  const v = validator(body)
  const patch = mode === "patch"
  const f = {
    weekday: field(v, "weekday", { required: !patch, parse: P.enum(WEEKDAYS) }),
    start_time: field(v, "start_time", { required: !patch, parse: P.time(false) }),
    end_time: field(v, "end_time", { required: !patch, parse: P.time(true) }),
  }
  v.check()
  const pick = merger(existing, patch)
  const rec = {
    id: existing?.id ?? uuid(),
    recurring_schedule_id: schedule.id,
    weekday: pick(f.weekday, "weekday"),
    start_time: pick(f.start_time, "start_time"),
    end_time: pick(f.end_time, "end_time"),
  }
  if (rec.end_time <= rec.start_time) v.fail("end_time", "The :attr must be a time after start time.")
  v.check()
  const overlapping = [...db.recurringScheduleBlocks.values()].some(
    (b) =>
      b.id !== rec.id &&
      b.recurring_schedule_id === schedule.id &&
      b.weekday === rec.weekday &&
      b.start_time < rec.end_time &&
      b.end_time > rec.start_time
  )
  if (overlapping) v.fail("start_time", "The schedule block overlaps with another block on the same weekday.")
  v.check()
  return stamp(rec, existing)
}

// ---------------------------------------------------------------------------
// Schedules, availability & bookable slots

/** Open time spans for a resource at a location, within [from, to]. */
function openSpans(resourceId, location, from, to) {
  const tz = location.time_zone
  const firstDay = localDayNum(from, tz) - 1
  const lastDay = localDayNum(to, tz) + 1
  let spans = []
  for (const rs of db.recurringSchedules.values()) {
    if (rs.resource_id !== resourceId || rs.location_id !== location.id) continue
    const blocks = [...db.recurringScheduleBlocks.values()].filter((b) => b.recurring_schedule_id === rs.id)
    if (!blocks.length) continue
    const startDay = dayNumOf(rs.start_date)
    const endDay = rs.end_date ? dayNumOf(rs.end_date) : Infinity
    const startMonday = startDay - weekdayIdx(startDay)
    for (let day = Math.max(firstDay, startDay); day <= Math.min(lastDay, endDay); day++) {
      const week = Math.floor((day - weekdayIdx(day) - startMonday) / 7)
      if (week % rs.interval !== 0) continue
      const weekday = WEEKDAYS[weekdayIdx(day)]
      for (const b of blocks) {
        if (b.weekday !== weekday) continue
        spans.push({ start: wallToMs(day, b.start_time, tz), end: wallToMs(day, b.end_time, tz) })
      }
    }
  }
  const blocks = [...db.scheduleBlocks.values()].filter(
    (b) => b.resource_id === resourceId && b.location_id === location.id && b.starts_at < to && b.ends_at > from
  )
  const toSpan = (b) => ({ start: b.starts_at, end: b.ends_at })
  spans = mergeSpans([...spans, ...blocks.filter((b) => b.is_available).map(toSpan)])
  spans = subtractSpans(spans, blocks.filter((b) => !b.is_available).map(toSpan))
  return mergeSpans(clipSpans(spans, from, to))
}

/** Non-canceled bookings occupying the resource (buffers included) within [from, to]. */
const occupyingBookings = (resourceId, from, to, extra = []) =>
  [...db.bookings.values(), ...extra].filter(
    (b) => b.resource_id === resourceId && !b.is_canceled && b.buffer_starts_at < to && b.buffer_ends_at > from
  )

/** Spans where the resource has reached max_simultaneous_bookings. */
function fullyBookedSpans(resource, from, to, extra = []) {
  const cap = resource.max_simultaneous_bookings
  if (cap === null || cap === undefined) return []
  const events = []
  for (const b of occupyingBookings(resource.id, from, to, extra)) {
    const tz = db.locations.get(b.location_id)?.time_zone ?? "UTC"
    events.push([b.buffer_starts_at, 1, tz], [b.buffer_ends_at, -1, tz])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out = []
  let count = 0
  let current = null
  for (const [t, delta, tz] of events) {
    count += delta
    if (count >= cap && !current) current = { start: t, tz }
    else if (count < cap && current) {
      out.push({ ...current, end: t })
      current = null
    }
  }
  return mergeSpans(clipSpans(out, from, to))
}

function orderByPriority(resources, location) {
  if (location?.resource_selection_strategy !== "prioritize") return resources
  const prio = location.resource_selection_priority ?? []
  const rank = (id) => (prio.includes(id) ? prio.indexOf(id) : Infinity)
  return [...resources].sort((a, b) => rank(a.id) - rank(b.id))
}

/** Picks a resource for a new booking, loosely following the location's strategy. */
function pickResource(service, location, booking, pending) {
  let candidates = associatedResources(service.id).filter((r) => r.enabled)
  const strategy = location.resource_selection_strategy
  if (strategy === "prioritize") candidates = orderByPriority(candidates, location)
  else if (strategy === "randomize") candidates = [...candidates].sort(() => rand() - 0.5)
  else if (strategy === "equalize") {
    const count = (r) => [...db.bookings.values()].filter((b) => b.resource_id === r.id && !b.is_canceled).length
    candidates = [...candidates].sort((a, b) => count(a) - count(b))
  }
  const free = candidates.find(
    (r) => fullyBookedSpans(r, booking.buffer_starts_at, booking.buffer_ends_at, pending).length === 0
  )
  return free ?? candidates[0] ?? null
}

function autoPrice(service, starts, ends, tz = "UTC") {
  if (!service || service.price === null || service.price === undefined) return null
  const price = Number(service.price)
  let total = price
  if (service.type === "flexible") total = (price * (ends - starts)) / HOUR
  else if (service.type === "day") {
    total = price * Math.max(1, localDayNum(ends - 1, tz) - localDayNum(starts, tz) + 1)
  }
  return total.toFixed(3)
}

const dayTimeFor = (value, dayNum) => (typeof value === "string" ? value : value[WEEKDAYS[weekdayIdx(dayNum)]])

function bookableSlots(service, location, resources, from, to, opts) {
  const tz = location.time_zone
  const now = clockNow()
  const earliest = opts.ignoreWindow ? -Infinity : now + (durationMs(service.booking_window_start) ?? 0)
  const latest =
    opts.ignoreWindow || !service.booking_window_end ? Infinity : now + durationMs(service.booking_window_end)
  const before = durationMs(service.buffer_time_before) ?? 0
  const after = durationMs(service.buffer_time_after) ?? 0

  let lookAhead = DAY
  if (service.type === "fixed") lookAhead += durationMs(service.duration)
  if (service.type === "flexible") lookAhead += service.max_duration ? durationMs(service.max_duration) : DAY
  const maxDays = service.max_days ?? Math.max(service.min_days ?? 1, service.default_days ?? 0, 7)
  if (service.type === "day") lookAhead += (maxDays + 1) * DAY

  const groups = new Map()
  let budget = 200_000 // guards against runaway loops on odd configurations

  for (const resource of resources) {
    const spans = openSpans(resource.id, location, from - DAY, to + lookAhead)
    const busy = fullyBookedSpans(resource, from - DAY - before, to + lookAhead + after)
    const isFree = (s, e) => !busy.some((b) => b.start < e && b.end > s)
    const nextBusyStart = (t) => Math.min(Infinity, ...busy.filter((b) => b.start >= t).map((b) => b.start))
    const emit = (slot) => {
      if (slot.starts_at < from || slot.starts_at >= to) return
      if (slot.starts_at < earliest || slot.starts_at > latest) return
      const key = [slot.buffer_starts_at, slot.starts_at, slot.ends_at, slot.buffer_ends_at, slot.min_ends_at ?? ""].join("|")
      const group = groups.get(key) ?? { ...slot, resources: [] }
      group.resources.push(resource)
      groups.set(key, group)
    }

    if (service.type === "fixed") {
      const length = durationMs(service.duration)
      const step = service.bookable_interval ? durationMs(service.bookable_interval) : length + before + after
      for (const span of spans) {
        for (let t = span.start; t + length <= span.end && budget-- > 0; t += step) {
          if (t + length < from || t >= to) continue
          if (!isFree(t - before, t + length + after)) continue
          emit({ buffer_starts_at: t - before, starts_at: t, ends_at: t + length, buffer_ends_at: t + length + after })
        }
      }
    } else if (service.type === "flexible") {
      const min = durationMs(service.min_duration)
      const max = service.max_duration ? durationMs(service.max_duration) : Infinity
      const durationStep = durationMs(service.duration_step) || MINUTE
      const length = opts.duration ?? (service.default_duration ? durationMs(service.default_duration) : min)
      const step = service.bookable_interval ? durationMs(service.bookable_interval) : durationStep
      for (const span of spans) {
        for (let t = span.start; t + length <= span.end && budget-- > 0; t += step) {
          if (t >= to) break
          if (t < from) continue
          if (!isFree(t - before, t + length + after)) continue
          const limit = Math.min(span.end, t + max, nextBusyStart(t + length + after) - after)
          let end = t + min + Math.floor((limit - t - min) / durationStep) * durationStep
          if (end < t + length) end = t + length
          emit({
            buffer_starts_at: t - before,
            starts_at: t,
            ends_at: end,
            buffer_ends_at: end + after,
            min_ends_at: t + min,
            min_buffer_ends_at: t + min + after,
          })
        }
      }
    } else if (service.type === "day") {
      const inSpan = (s, e) => spans.some((sp) => sp.start <= s && sp.end >= e)
      for (let day = localDayNum(from, tz); day <= localDayNum(to, tz) && budget-- > 0; day++) {
        const ends = []
        let first = null
        for (let k = 0; k < maxDays; k++) {
          const d = day + k
          const s = wallToMs(d, dayTimeFor(service.start_time, d), tz)
          let e = wallToMs(d, dayTimeFor(service.end_time, d), tz)
          if (e <= s) e = wallToMs(d + 1, dayTimeFor(service.end_time, d), tz)
          if (!inSpan(s, e) || !isFree(k === 0 ? s - before : s, e)) break
          if (k === 0) first = s
          ends.push(e)
        }
        if (first === null || ends.length < service.min_days) continue
        const minEnd = ends[service.min_days - 1]
        const maxEnd = ends.at(-1)
        if (!isFree(maxEnd, maxEnd + after)) continue
        emit({
          buffer_starts_at: first - before,
          starts_at: first,
          ends_at: maxEnd,
          buffer_ends_at: maxEnd + after,
          min_ends_at: minEnd,
          min_buffer_ends_at: minEnd + after,
        })
      }
    }
  }

  return [...groups.values()]
    .filter((g) => g.resources.length >= opts.numResources)
    .sort((a, b) => a.starts_at - b.starts_at || a.ends_at - b.ends_at)
    .map((g) => {
      const out = {
        buffer_starts_at: fmt(g.buffer_starts_at, tz),
        starts_at: fmt(g.starts_at, tz),
        ends_at: fmt(g.ends_at, tz),
        buffer_ends_at: fmt(g.buffer_ends_at, tz),
      }
      if (g.min_ends_at !== undefined) {
        out.min_ends_at = fmt(g.min_ends_at, tz)
        out.min_buffer_ends_at = fmt(g.min_buffer_ends_at, tz)
      }
      out.resources = g.resources.map(serResource)
      return out
    })
}

/** Validates from/to (and optionally location) query parameters. */
function rangeQuery(q, { requireLocation = false } = {}) {
  const errors = {}
  const add = (k, m) => (errors[k] ??= []).push(m)
  const read = (name) => {
    const raw = q.get(name)
    if (raw === undefined) {
      add(name, `The ${name} field is required.`)
      return null
    }
    const ms = parseDateTime(raw)
    if (ms === null) add(name, `The ${name} must match the format Y-m-d\\TH:i:sP.`)
    return ms
  }
  const from = read("from")
  const to = read("to")
  if (from !== null && to !== null) {
    if (to <= from) add("to", "The to must be a date after from.")
    else if (to - from > MAX_RANGE) add("to", "The range between from and to may not exceed 366 days.")
  }
  const location = q.get("location")
  if (requireLocation && !location) add("location", "The location field is required.")
  return { from, to, location, errors, add }
}

// ---------------------------------------------------------------------------
// Bookings

/**
 * Validates a booking body. Returns { record } or { errors } (does not throw), so booking
 * groups can collect errors per row. mode: create | put | patch.
 */
function buildBooking(body, existing, mode, { prefix = "", inGroup = false, pending = [] } = {}) {
  const v = validator(body, prefix)
  const create = mode === "create"
  const put = mode === "put"
  const patch = mode === "patch"

  const f = {
    service_id: field(v, "service_id", { required: create, present: put, nullable: put, parse: P.exists(db.services) }),
    location_id: field(v, "location_id", { required: create, present: put, nullable: put, parse: P.exists(db.locations) }),
    resource_id: field(v, "resource_id", { present: put, nullable: !patch, parse: P.exists(db.resources) }),
    starts_at: field(v, "starts_at", { required: !patch, parse: P.dateTime }),
    ends_at: field(v, "ends_at", { required: !patch, parse: P.dateTime }),
    buffer_starts_at: field(v, "buffer_starts_at", { parse: P.dateTime }),
    buffer_ends_at: field(v, "buffer_ends_at", { parse: P.dateTime }),
    price: field(v, "price", { nullable: true, parse: P.price }),
    metadata: field(v, "metadata", { nullable: true, parse: P.metadata }),
    protected_metadata: field(v, "protected_metadata", { nullable: true, parse: P.metadata }),
    is_temporary: field(v, "is_temporary", { parse: P.bool }),
    is_canceled: create ? ABSENT : field(v, "is_canceled", { parse: P.bool }),
    booking_group_id: inGroup
      ? ABSENT
      : field(v, "booking_group_id", { nullable: true, parse: P.exists(db.bookingGroups) }),
  }
  for (const flag of BOOKING_FLAGS) field(v, flag, { parse: P.bool })
  if (!v.ok) {
    // Report the ordering rule alongside other field errors, like Laravel does.
    const starts = f.starts_at !== ABSENT ? f.starts_at : existing?.starts_at
    const ends = f.ends_at !== ABSENT ? f.ends_at : existing?.ends_at
    if (typeof starts === "number" && typeof ends === "number" && ends <= starts) {
      v.fail("ends_at", "The :attr must be a date after starts at.")
    }
    return { errors: v.errors }
  }

  const pick = merger(existing, patch)
  const now = nowMs()
  const rec = {
    id: existing?.id ?? uuid(),
    resource_id: pick(f.resource_id, "resource_id"),
    service_id: pick(f.service_id, "service_id"),
    location_id: pick(f.location_id, "location_id"),
    booking_group_id: f.booking_group_id !== ABSENT ? f.booking_group_id : (existing?.booking_group_id ?? null),
    metadata: pick(f.metadata, "metadata"),
    protected_metadata: pick(f.protected_metadata, "protected_metadata"),
    is_temporary: f.is_temporary !== ABSENT ? f.is_temporary : (existing?.is_temporary ?? false),
    is_canceled: f.is_canceled !== ABSENT ? f.is_canceled : (existing?.is_canceled ?? false),
    starts_at: pick(f.starts_at, "starts_at"),
    ends_at: pick(f.ends_at, "ends_at"),
  }
  const service = rec.service_id ? db.services.get(rec.service_id) : null
  const location = rec.location_id ? db.locations.get(rec.location_id) : null

  if (rec.ends_at <= rec.starts_at) v.fail("ends_at", "The :attr must be a date after starts at.")

  const timingChanged = !patch || f.starts_at !== ABSENT || f.ends_at !== ABSENT || f.service_id !== ABSENT
  const before = durationMs(service?.buffer_time_before) ?? 0
  const after = durationMs(service?.buffer_time_after) ?? 0
  rec.buffer_starts_at =
    f.buffer_starts_at !== ABSENT ? f.buffer_starts_at : timingChanged ? rec.starts_at - before : existing.buffer_starts_at
  rec.buffer_ends_at =
    f.buffer_ends_at !== ABSENT ? f.buffer_ends_at : timingChanged ? rec.ends_at + after : existing.buffer_ends_at
  if (rec.buffer_starts_at > rec.starts_at) {
    v.fail("buffer_starts_at", "The :attr must be a date before or equal to starts at.")
  }
  if (rec.buffer_ends_at < rec.ends_at) v.fail("buffer_ends_at", "The :attr must be a date after or equal to ends at.")
  rec.price =
    f.price !== ABSENT
      ? f.price
      : timingChanged
        ? autoPrice(service, rec.starts_at, rec.ends_at, location?.time_zone)
        : existing.price

  if (existing && existing.finalized_at !== null && rec.is_temporary) {
    v.fail("is_temporary", "A finalized booking can't be made temporary.")
  }

  if (create && rec.resource_id === null && service && location && v.ok) {
    const resource = pickResource(service, location, rec, pending)
    if (resource) rec.resource_id = resource.id
    else v.fail("resource_id", "No resource is associated with this service, so the booking can't be placed.")
  }
  if (!v.ok) return { errors: v.errors }

  rec.finalized_at = existing?.finalized_at ?? null
  if (!rec.is_temporary && rec.finalized_at === null) rec.finalized_at = now
  rec.canceled_at = rec.is_canceled ? (existing?.is_canceled ? existing.canceled_at : now) : null
  return { record: stamp(rec, existing) }
}

const BOOKING_FILTER_KEYS = [
  "from",
  "to",
  "resource",
  "service",
  "location",
  "temporary",
  "canceled",
  "price",
  "starts_at",
  "ends_at",
  "buffer_starts_at",
  "buffer_ends_at",
  "finalized_at",
  "canceled_at",
  "metadata",
  "protected_metadata",
  "created_at",
  "updated_at",
]

function bookingPredicate(q) {
  const from = optDateTimeParam(q, "from")
  const to = optDateTimeParam(q, "to")
  const temporary = inclusion(q, "temporary")
  const canceled = inclusion(q, "canceled")
  return all([
    from !== null && ((b) => b.ends_at > from),
    to !== null && ((b) => b.starts_at < to),
    equalsParam(q, "resource", (b) => b.resource_id),
    equalsParam(q, "service", (b) => b.service_id),
    equalsParam(q, "location", (b) => b.location_id),
    (b) => temporary(b.is_temporary),
    (b) => canceled(b.is_canceled),
    opPredicate(q, "price", "number", (b) => (b.price === null ? null : Number(b.price))),
    ...["starts_at", "ends_at", "buffer_starts_at", "buffer_ends_at", "finalized_at", "canceled_at"].map((k) =>
      opPredicate(q, k, "datetime", (b) => b[k])
    ),
    ...metadataPredicates(q),
    ...timestampPredicates(q),
  ])
}

function bookingErrorsToGroup(errors, index, allErrors, messages) {
  Object.assign(allErrors, errors)
  messages[`bookings.${index}`] = Object.values(errors)[0][0]
}

function groupItems(body, v, required) {
  if (!v.has("bookings")) {
    if (required) v.fail("bookings", "The :attr field is required.")
    return null
  }
  const items = body.bookings
  if (!Array.isArray(items)) {
    v.fail("bookings", "The :attr must be an array.")
    return null
  }
  if (items.length === 0) {
    v.fail("bookings", "The :attr must have at least 1 item.")
    return null
  }
  return items
}

function createBookingGroup(ctx) {
  const body = ctx.body
  const v = validator(body)
  const items = groupItems(body, v, true)
  const metadata = field(v, "metadata", { nullable: true, parse: P.metadata })
  const protectedMetadata = field(v, "protected_metadata", { nullable: true, parse: P.metadata })
  const errors = { ...v.errors }
  const messages = {}
  const records = []
  ;(items ?? []).forEach((item, i) => {
    if (!isPlainObject(item)) {
      return bookingErrorsToGroup({ [`bookings.${i}`]: [`The bookings.${i} must be an object.`] }, i, errors, messages)
    }
    const res = buildBooking(item, null, "create", { prefix: `bookings.${i}.`, inGroup: true, pending: records })
    if (res.errors) bookingErrorsToGroup(res.errors, i, errors, messages)
    else records.push(res.record)
  })
  if (Object.keys(errors).length) {
    throw invalid(errors, Object.keys(messages).length ? { messages } : {})
  }
  const group = stamp({
    id: uuid(),
    metadata: metadata === ABSENT ? null : metadata,
    protected_metadata: protectedMetadata === ABSENT ? null : protectedMetadata,
  })
  db.bookingGroups.set(group.id, group)
  for (const r of records) {
    r.booking_group_id = group.id
    db.bookings.set(r.id, r)
  }
  return group
}

function updateBookingGroup(ctx, group, mode) {
  const body = ctx.body
  const patch = mode === "patch"
  const v = validator(body)
  const items = groupItems(body, v, !patch)
  const metadata = field(v, "metadata", { nullable: true, parse: P.metadata })
  const protectedMetadata = field(v, "protected_metadata", { nullable: true, parse: P.metadata })
  const errors = { ...v.errors }
  const messages = {}
  const existing = bookingsOfGroup(group.id)
  const keep = new Set()
  const updates = []
  const creates = []

  ;(items ?? []).forEach((item, i) => {
    const prefix = `bookings.${i}.`
    if (!isPlainObject(item)) {
      return bookingErrorsToGroup({ [`bookings.${i}`]: [`The bookings.${i} must be an object.`] }, i, errors, messages)
    }
    if (item.id !== undefined && item.id !== null) {
      const current = existing.find((b) => b.id === item.id)
      if (!current || keep.has(item.id)) {
        return bookingErrorsToGroup({ [`${prefix}id`]: [`The selected ${prefix}id is invalid.`] }, i, errors, messages)
      }
      keep.add(current.id)
      const changes = Object.keys(item).filter((k) => k !== "id" && item[k] !== undefined)
      if (!changes.length) return // id only: leave the booking unchanged
      const res = buildBooking(item, current, patch ? "patch" : "put", { prefix, inGroup: true })
      if (res.errors) bookingErrorsToGroup(res.errors, i, errors, messages)
      else updates.push(res.record)
    } else {
      const res = buildBooking(item, null, "create", {
        prefix,
        inGroup: true,
        pending: [...updates, ...creates],
      })
      if (res.errors) bookingErrorsToGroup(res.errors, i, errors, messages)
      else creates.push(res.record)
    }
  })
  if (Object.keys(errors).length) {
    throw invalid(errors, Object.keys(messages).length ? { messages } : {})
  }

  if (items) {
    for (const b of existing) if (!keep.has(b.id)) db.bookings.delete(b.id)
  }
  for (const r of updates) db.bookings.set(r.id, r)
  for (const r of creates) {
    r.booking_group_id = group.id
    db.bookings.set(r.id, r)
  }
  const pick = merger(group, patch)
  const next = stamp(
    {
      id: group.id,
      metadata: pick(metadata, "metadata"),
      protected_metadata: pick(protectedMetadata, "protected_metadata"),
    },
    group
  )
  db.bookingGroups.set(next.id, next)
  return next
}

// ---------------------------------------------------------------------------
// Cascading deletes

function deleteLocation(loc) {
  db.locations.delete(loc.id)
  for (const b of db.scheduleBlocks.values()) if (b.location_id === loc.id) db.scheduleBlocks.delete(b.id)
  for (const rs of db.recurringSchedules.values()) if (rs.location_id === loc.id) deleteRecurringSchedule(rs)
  for (const b of db.bookings.values()) if (b.location_id === loc.id) b.location_id = null
}

function deleteResource(res) {
  db.resources.delete(res.id)
  db.resourceServices = db.resourceServices.filter((a) => a.resource_id !== res.id)
  for (const b of db.scheduleBlocks.values()) if (b.resource_id === res.id) db.scheduleBlocks.delete(b.id)
  for (const rs of db.recurringSchedules.values()) if (rs.resource_id === res.id) deleteRecurringSchedule(rs)
  for (const b of db.bookings.values()) if (b.resource_id === res.id) b.resource_id = null
  for (const l of db.locations.values()) {
    l.resource_selection_priority = (l.resource_selection_priority ?? []).filter((id) => id !== res.id)
  }
}

function deleteService(svc) {
  db.services.delete(svc.id)
  db.resourceServices = db.resourceServices.filter((a) => a.service_id !== svc.id)
  for (const b of db.bookings.values()) if (b.service_id === svc.id) b.service_id = null
}

function deleteRecurringSchedule(rs) {
  db.recurringSchedules.delete(rs.id)
  for (const b of db.recurringScheduleBlocks.values()) {
    if (b.recurring_schedule_id === rs.id) db.recurringScheduleBlocks.delete(b.id)
  }
}

function deleteBookingGroup(g) {
  db.bookingGroups.delete(g.id)
  for (const b of bookingsOfGroup(g.id)) db.bookings.delete(b.id)
}

// ---------------------------------------------------------------------------
// Router

const routes = []

function route(method, pattern, handler) {
  routes.push({ method, parts: pattern.split("/").filter(Boolean), handler })
}

function matchRoute(method, segments) {
  let pathMatched = false
  for (const r of routes) {
    if (r.parts.length !== segments.length) continue
    const params = {}
    const matched = r.parts.every((p, i) => {
      if (p.startsWith(":")) {
        params[p.slice(1)] = segments[i]
        return true
      }
      return p === segments[i]
    })
    if (!matched) continue
    pathMatched = true
    if (r.method === method) return { handler: r.handler, params }
  }
  return pathMatched ? "method-not-allowed" : null
}

const respond = (body, status = 200) => ({ status, body })

function mustGet(map, id) {
  const rec = map.get(id)
  if (!rec) throw notFound()
  return rec
}

const parents = {
  resource: (p) => mustGet(db.resources, p.resource),
  recurringSchedule: (p) => {
    const resource = mustGet(db.resources, p.resource)
    const rs = mustGet(db.recurringSchedules, p.schedule)
    if (rs.resource_id !== resource.id) throw notFound()
    return rs
  },
}

/**
 * Registers list/create/get/put/patch/delete for an entity.
 * ent: { store, parent?, belongs?, build, ser, filter, sort, remove, create?, update? }
 */
function crud(base, ent) {
  const one = `${base}/:id`
  const parentOf = (ctx) => (ent.parent ? ent.parent(ctx.params) : null)
  const load = (ctx) => {
    const parent = parentOf(ctx)
    const rec = ent.store().get(ctx.params.id)
    if (!rec || (ent.belongs && !ent.belongs(rec, parent))) throw notFound()
    return { parent, rec }
  }
  const save = (rec) => (ent.store().set(rec.id, rec), rec)

  route("GET", base, (ctx) => {
    const parent = parentOf(ctx)
    let items = [...ent.store().values()]
    if (ent.belongs) items = items.filter((r) => ent.belongs(r, parent))
    items = items.filter(ent.filter(ctx.query, parent))
    items = applySort(items, ctx.query, ent.sort, ent.sortGetters)
    return respond(paginate(ctx, items, ent.ser))
  })
  route("POST", base, (ctx) => {
    const parent = parentOf(ctx)
    const rec = ent.create ? ent.create(ctx, parent) : save(ent.build(ctx.body, null, "create", parent))
    return respond(ent.ser(rec), 201)
  })
  route("GET", one, (ctx) => respond(ent.ser(load(ctx).rec)))
  for (const [method, mode] of [
    ["PUT", "put"],
    ["PATCH", "patch"],
  ]) {
    route(method, one, (ctx) => {
      const { parent, rec } = load(ctx)
      const next = ent.update ? ent.update(ctx, rec, mode) : save(ent.build(ctx.body, rec, mode, parent))
      return respond(ent.ser(next))
    })
  }
  route("DELETE", one, (ctx) => {
    ent.remove(load(ctx).rec)
    return { status: 204 }
  })
}

const TS = ["created_at", "updated_at"]

// --- Project
route("GET", "/project", () => respond(serProject()))

// --- Locations
crud("/locations", {
  store: () => db.locations,
  build: buildLocation,
  ser: serLocation,
  remove: deleteLocation,
  sort: ["name", "time_zone", "resource_selection_strategy", "enabled", ...TS],
  filter: (q) => {
    const disabled = inclusion(q, "disabled")
    return all([
      (l) => disabled(!l.enabled),
      opPredicate(q, "name", "string", (l) => l.name),
      equalsParam(q, "timezone", (l) => l.time_zone),
      equalsParam(q, "time_zone", (l) => l.time_zone),
      equalsParam(q, "resource_selection_strategy", (l) => l.resource_selection_strategy),
      ...metadataPredicates(q),
      ...timestampPredicates(q),
    ])
  },
})

// --- Resources
crud("/resources", {
  store: () => db.resources,
  build: buildResource,
  ser: serResource,
  remove: deleteResource,
  sort: ["name", "max_simultaneous_bookings", "enabled", ...TS],
  filter: (q) => {
    const disabled = inclusion(q, "disabled")
    return all([
      (r) => disabled(!r.enabled),
      opPredicate(q, "name", "string", (r) => r.name),
      opPredicate(q, "max_simultaneous_bookings", "number", (r) => r.max_simultaneous_bookings),
      ...metadataPredicates(q),
      ...timestampPredicates(q),
    ])
  },
})

// --- Services
crud("/services", {
  store: () => db.services,
  build: buildService,
  ser: serService,
  remove: deleteService,
  sort: ["name", "type", "price", "enabled", ...TS],
  filter: (q) => {
    const disabled = inclusion(q, "disabled")
    const type = q.get("type")
    if (type !== undefined && !SERVICE_TYPES.includes(type)) throw invalid({ type: ["The selected type is invalid."] })
    return all([
      (s) => disabled(!s.enabled),
      opPredicate(q, "name", "string", (s) => s.name),
      opPredicate(q, "price", "number", (s) => (s.price === null ? null : Number(s.price))),
      type !== undefined && ((s) => s.type === type),
      ...metadataPredicates(q),
      ...timestampPredicates(q),
    ])
  },
})

// --- Resource <-> service associations (not paginated)
function associationRoutes(base, first, second) {
  // first/second: "resource" | "service"
  const maps = { resource: () => db.resources, service: () => db.services }
  const ids = (p) => ({
    resource_id: mustGet(maps.resource(), p.resource).id,
    service_id: mustGet(maps.service(), p.service).id,
  })
  const find = ({ resource_id, service_id }) =>
    db.resourceServices.find((a) => a.resource_id === resource_id && a.service_id === service_id)

  route("GET", `${base}/:${first}/${second}s`, (ctx) => {
    const id = mustGet(maps[first](), ctx.params[first]).id
    return respond(db.resourceServices.filter((a) => a[`${first}_id`] === id).map(serAssociation))
  })
  route("GET", `${base}/:${first}/${second}s/:${second}`, (ctx) => {
    const a = find(ids(ctx.params))
    if (!a) throw notFound()
    return respond(serAssociation(a))
  })
  route("PUT", `${base}/:${first}/${second}s/:${second}`, (ctx) => {
    const key = ids(ctx.params)
    const a = find(key)
    if (a) return respond(serAssociation(a), 200)
    const created = { ...key, created_at: nowMs() }
    db.resourceServices.push(created)
    return respond(serAssociation(created), 201)
  })
  route("DELETE", `${base}/:${first}/${second}s/:${second}`, (ctx) => {
    const a = find(ids(ctx.params))
    if (!a) throw notFound()
    db.resourceServices = db.resourceServices.filter((x) => x !== a)
    return { status: 204 }
  })
}
associationRoutes("/resources", "resource", "service")
associationRoutes("/services", "service", "resource")

// --- Resource schedule & fully booked
route("GET", "/resources/:resource/schedule", (ctx) => {
  const resource = parents.resource(ctx.params)
  const { from, to, location: locationId, errors, add } = rangeQuery(ctx.query, { requireLocation: true })
  const fullyBooked = ctx.query.get("fully_booked") ?? "include"
  if (!["include", "exclude"].includes(fullyBooked)) add("fully_booked", "The selected fully booked is invalid.")
  if (Object.keys(errors).length) throw invalid(errors)
  const location = mustGet(db.locations, locationId)
  let spans = openSpans(resource.id, location, from, to)
  if (fullyBooked === "exclude") spans = subtractSpans(spans, fullyBookedSpans(resource, from, to))
  const tz = location.time_zone
  return respond(paginate(ctx, spans, (s) => ({ starts_at: fmt(s.start, tz), ends_at: fmt(s.end, tz) })))
})

route("GET", "/resources/:resource/fully-booked", (ctx) => {
  const resource = parents.resource(ctx.params)
  const { from, to, errors } = rangeQuery(ctx.query)
  if (Object.keys(errors).length) throw invalid(errors)
  const spans = fullyBookedSpans(resource, from, to)
  return respond(paginate(ctx, spans, (s) => ({ starts_at: fmt(s.start, s.tz), ends_at: fmt(s.end, s.tz) })))
})

// --- Schedule blocks
crud("/resources/:resource/schedule-blocks", {
  store: () => db.scheduleBlocks,
  parent: parents.resource,
  belongs: (b, resource) => b.resource_id === resource.id,
  build: buildScheduleBlock,
  ser: serScheduleBlock,
  remove: (b) => db.scheduleBlocks.delete(b.id),
  sort: ["starts_at", "ends_at", "is_available", ...TS],
  filter: (q) => {
    const from = optDateTimeParam(q, "from")
    const to = optDateTimeParam(q, "to")
    return all([
      from !== null && ((b) => b.ends_at > from),
      to !== null && ((b) => b.starts_at < to),
      equalsParam(q, "location", (b) => b.location_id),
      opPredicate(q, "starts_at", "datetime", (b) => b.starts_at),
      opPredicate(q, "ends_at", "datetime", (b) => b.ends_at),
      ...timestampPredicates(q),
    ])
  },
})

// --- Recurring schedules
crud("/resources/:resource/recurring-schedules", {
  store: () => db.recurringSchedules,
  parent: parents.resource,
  belongs: (rs, resource) => rs.resource_id === resource.id,
  build: buildRecurringSchedule,
  ser: serRecurringSchedule,
  remove: deleteRecurringSchedule,
  sort: ["start_date", "end_date", "interval", ...TS],
  filter: (q) => {
    const from = q.get("from") === undefined ? null : parseFilterValue(q.get("from"), "date", "from")
    const to = q.get("to") === undefined ? null : parseFilterValue(q.get("to"), "date", "to")
    return all([
      from !== null && ((rs) => rs.end_date === null || rs.end_date >= from),
      to !== null && ((rs) => rs.start_date <= to),
      equalsParam(q, "location", (rs) => rs.location_id),
      opPredicate(q, "start_date", "date", (rs) => rs.start_date),
      opPredicate(q, "end_date", "date", (rs) => rs.end_date),
      ...timestampPredicates(q),
    ])
  },
})

// --- Recurring schedule blocks
crud("/resources/:resource/recurring-schedules/:schedule/schedule-blocks", {
  store: () => db.recurringScheduleBlocks,
  parent: parents.recurringSchedule,
  belongs: (b, rs) => b.recurring_schedule_id === rs.id,
  build: buildRecurringScheduleBlock,
  ser: serRecurringScheduleBlock,
  remove: (b) => db.recurringScheduleBlocks.delete(b.id),
  sort: ["weekday", "start_time", "end_time", ...TS],
  filter: (q) => {
    const weekday = q.get("weekday")
    if (weekday !== undefined && !WEEKDAYS.includes(weekday)) throw invalid({ weekday: ["The selected weekday is invalid."] })
    return all([
      weekday !== undefined && ((b) => b.weekday === weekday),
      opPredicate(q, "start_time", "time", (b) => b.start_time),
      opPredicate(q, "end_time", "time", (b) => b.end_time),
      ...timestampPredicates(q),
    ])
  },
})

// --- Bookable slots
route("GET", "/services/:service/bookable-slots", (ctx) => {
  const service = mustGet(db.services, ctx.params.service)
  const q = ctx.query
  const { from, to, location: locationId, errors, add } = rangeQuery(q, { requireLocation: true })
  let duration = null
  if (q.get("duration") !== undefined && service.type === "flexible") {
    duration = durationMs(q.get("duration"))
    const min = durationMs(service.min_duration)
    const max = service.max_duration ? durationMs(service.max_duration) : Infinity
    if (duration === null) add("duration", "The duration must be a valid ISO 8601 duration.")
    else if (duration < min || duration > max) add("duration", "The duration must be between the service's min and max duration.")
  }
  let numResources = 1
  const rawNum = q.get("num_resources")
  if (rawNum !== undefined) {
    numResources = /^\d+$/.test(rawNum) ? Number(rawNum) : NaN
    if (!(numResources >= 1)) add("num_resources", "The num resources must be at least 1.")
  }
  const ignore = q.get("ignore_booking_window") ?? "false"
  if (!["true", "false", "1", "0"].includes(ignore)) {
    add("ignore_booking_window", "The ignore booking window field must be true or false.")
  }
  if (Object.keys(errors).length) throw invalid(errors)

  const location = mustGet(db.locations, locationId)
  let resources
  const resourceId = q.get("resource")
  if (resourceId) {
    const resource = mustGet(db.resources, resourceId)
    const associated = associatedResources(service.id).some((r) => r.id === resource.id)
    resources = associated && resource.enabled ? [resource] : []
  } else {
    resources = orderByPriority(associatedResources(service.id).filter((r) => r.enabled), location)
  }
  const slots = bookableSlots(service, location, resources, from, to, {
    duration,
    numResources,
    ignoreWindow: ignore === "true" || ignore === "1",
  })
  return respond(paginate(ctx, slots, (s) => s))
})

// --- Bookings
crud("/bookings", {
  store: () => db.bookings,
  build: (body, existing, mode) => {
    const res = buildBooking(body, existing, mode)
    if (res.errors) throw invalid(res.errors)
    return res.record
  },
  ser: (b) => serBooking(b, true),
  remove: (b) => db.bookings.delete(b.id),
  sort: [
    "starts_at",
    "ends_at",
    "buffer_starts_at",
    "buffer_ends_at",
    "price",
    "is_temporary",
    "is_canceled",
    "finalized_at",
    "canceled_at",
    ...TS,
  ],
  filter: bookingPredicate,
})

// --- Booking groups

/** Earliest/latest instant (ms) of a timestamp field across a group's bookings (null if empty). */
function groupEdge(group, field, pick) {
  const times = bookingsOfGroup(group.id).map((b) => b[field])
  return times.length ? pick(...times) : null
}

crud("/booking-groups", {
  store: () => db.bookingGroups,
  create: (ctx) => createBookingGroup(ctx),
  update: (ctx, group, mode) => updateBookingGroup(ctx, group, mode),
  ser: serBookingGroup,
  remove: deleteBookingGroup,
  // Same sort enum as bookings (Hapio API spec). Booking times sort by the group's
  // earliest start / latest end; created_at and updated_at are the group's own.
  sort: ["starts_at", "ends_at", "buffer_starts_at", "buffer_ends_at", ...TS],
  sortGetters: {
    starts_at: (g) => groupEdge(g, "starts_at", Math.min),
    ends_at: (g) => groupEdge(g, "ends_at", Math.max),
    buffer_starts_at: (g) => groupEdge(g, "buffer_starts_at", Math.min),
    buffer_ends_at: (g) => groupEdge(g, "buffer_ends_at", Math.max),
  },
  filter: (q) => {
    // Inclusion filters set to "include" match every booking, so they don't count as a
    // booking filter: groups without bookings stay listed. (Real Hapio's behaviour for
    // empty groups is undocumented.)
    const explicit = q.entries.some(
      (e) =>
        BOOKING_FILTER_KEYS.includes(e.base) &&
        !((e.base === "temporary" || e.base === "canceled") && e.value === "include")
    )
    const matchesBooking = explicit ? bookingPredicate(q) : null
    return all([
      matchesBooking && ((g) => bookingsOfGroup(g.id).some(matchesBooking)),
      ...metadataPredicates(q, "group_"),
      ...timestampPredicates(q, "group_"),
    ])
  },
})

// ---------------------------------------------------------------------------
// Seed data (relative to today so the demo always looks current)

function seed() {
  db = emptyDb()
  rng = currentSeed === null ? null : mulberry32(currentSeed)
  stampClock = 0
  const realNow = clockNow()
  seedClock = Math.floor((realNow - 21 * DAY) / SECOND) * SECOND
  try {
    db.project = stamp({ id: uuid(), name: "Demo project", enabled: true })
    if (process.env.MOCK_EMPTY === "1" || seed.empty) return

    const put = (map, rec) => (map.set(rec.id, rec), rec)
    const sthlm = put(
      db.locations,
      buildLocation(
        {
          name: "Stockholm Studio",
          time_zone: "Europe/Stockholm",
          resource_selection_strategy: "prioritize",
          metadata: { address: "Götgatan 12, Stockholm", floor: 2 },
        },
        null,
        "create"
      )
    )
    const ny = put(
      db.locations,
      buildLocation(
        {
          name: "New York Loft",
          time_zone: "America/New_York",
          resource_selection_strategy: "randomize",
          metadata: { address: "120 Wooster St, New York", floor: 5 },
        },
        null,
        "create"
      )
    )

    const anna = put(db.resources, buildResource({ name: "Anna", metadata: { role: "stylist", level: 3 } }, null, "create"))
    const ben = put(db.resources, buildResource({ name: "Ben", metadata: { role: "stylist", level: 2 } }, null, "create"))
    const roomA = put(
      db.resources,
      buildResource({ name: "Room A", max_simultaneous_bookings: 2, metadata: { role: "room", capacity: 6 } }, null, "create")
    )
    sthlm.resource_selection_priority = [anna.id, ben.id, roomA.id]

    const haircut = put(
      db.services,
      buildService(
        { name: "Haircut", type: "fixed", duration: "PT45M", price: "450.000", buffer_time_after: "PT15M", metadata: { category: "hair" } },
        null,
        "create"
      )
    )
    const studio = put(
      db.services,
      buildService(
        {
          name: "Studio rental",
          type: "flexible",
          min_duration: "PT1H",
          max_duration: "PT4H",
          duration_step: "PT30M",
          price: "300.000",
          metadata: { category: "space" },
        },
        null,
        "create"
      )
    )
    const equipment = put(
      db.services,
      buildService(
        {
          name: "Equipment rental",
          type: "day",
          start_time: "09:00:00",
          end_time: "17:00:00",
          min_days: 1,
          max_days: 7,
          price: "150.000",
          metadata: { category: "equipment" },
        },
        null,
        "create"
      )
    )

    const associate = (r, s) => db.resourceServices.push({ resource_id: r.id, service_id: s.id, created_at: nowMs() })
    for (const r of [anna, ben, roomA]) {
      associate(r, haircut)
      associate(r, studio)
    }
    associate(roomA, equipment)

    const tz = sthlm.time_zone
    const today = localDayNum(realNow, tz)
    const weekdaySchedule = (resource, location) => {
      const rs = put(
        db.recurringSchedules,
        buildRecurringSchedule({ location_id: location.id, start_date: dateOfDayNum(today - 30) }, null, "create", resource)
      )
      for (const weekday of WEEKDAYS.slice(0, 5)) {
        put(
          db.recurringScheduleBlocks,
          buildRecurringScheduleBlock({ weekday, start_time: "09:00:00", end_time: "17:00:00" }, null, "create", rs)
        )
      }
    }
    weekdaySchedule(anna, sthlm)
    weekdaySchedule(anna, ny)
    weekdaySchedule(ben, sthlm)
    weekdaySchedule(roomA, sthlm)

    const at = (dayNum, time, zone = tz) => fmt(wallToMs(dayNum, time, zone), zone)
    const nextMonday = today - weekdayIdx(today) + 7
    const block = (resource, dayOffset, start, end) =>
      put(
        db.scheduleBlocks,
        buildScheduleBlock(
          { location_id: sthlm.id, starts_at: at(nextMonday + dayOffset, start), ends_at: at(nextMonday + dayOffset, end), is_available: false },
          null,
          "create",
          resource
        )
      )
    block(anna, 2, "12:00:00", "14:00:00") // Wednesday lunch
    block(ben, 1, "09:00:00", "12:00:00") // Tuesday morning
    block(roomA, 3, "13:00:00", "17:00:00") // Thursday afternoon

    // n business days from today (negative = past).
    const businessDay = (n) => {
      let d = today
      for (let left = Math.abs(n); left > 0; ) {
        d += Math.sign(n)
        if (weekdayIdx(d) < 5) left--
      }
      return d
    }
    const book = (resource, service, location, day, start, endDay, end, extra = {}) => {
      const zone = location.time_zone
      const res = buildBooking(
        {
          resource_id: resource.id,
          service_id: service.id,
          location_id: location.id,
          starts_at: at(day, start, zone),
          ends_at: at(endDay, end, zone),
          ...extra,
        },
        null,
        "create"
      )
      if (res.errors) throw new Error(`Seed booking failed: ${JSON.stringify(res.errors)}`)
      return put(db.bookings, res.record)
    }
    const customer = (name, source, more = {}) => ({
      metadata: { customer: { name, email: `${name.split(" ")[0].toLowerCase()}@example.com` }, source, ...more },
    })

    // Past
    let d = businessDay(-5)
    book(anna, haircut, sthlm, d, "10:00:00", d, "10:45:00", customer("Maja Holm", "phone"))
    d = businessDay(-4)
    book(ben, haircut, sthlm, d, "14:00:00", d, "14:45:00", customer("Oskar Berg", "web"))
    d = businessDay(-3)
    book(roomA, studio, sthlm, d, "10:00:00", d, "12:00:00", customer("Lumen Collective", "web"))
    d = businessDay(-1)
    const canceled = book(anna, haircut, sthlm, d, "15:00:00", d, "15:45:00", customer("Sara Ek", "web"))
    canceled.is_canceled = true
    canceled.canceled_at = nowMs()

    // Upcoming
    d = businessDay(1)
    book(anna, haircut, sthlm, d, "09:00:00", d, "09:45:00", customer("Erik Lund", "web", { vip: true }))
    book(ben, haircut, sthlm, d, "14:00:00", d, "14:45:00", customer("Nora Falk", "phone"))
    d = businessDay(2)
    book(roomA, studio, sthlm, d, "09:30:00", d, "11:30:00", customer("Pixel & Co", "web"))
    let rentStart = businessDay(3)
    while (weekdayIdx(rentStart) > 3) rentStart++ // two-day rental that ends on a weekday
    book(roomA, equipment, sthlm, rentStart, "09:00:00", rentStart + 1, "17:00:00", customer("Fotostudion AB", "email"))
    d = businessDay(4)
    book(anna, haircut, sthlm, d, "10:00:00", d, "10:45:00", { ...customer("Ida Strand", "web"), is_temporary: true })
    d = businessDay(6)
    book(anna, haircut, ny, d, "10:00:00", d, "10:45:00", customer("Jamie Carter", "web"))
    d = businessDay(8)
    book(ben, haircut, sthlm, d, "15:00:00", d, "15:45:00", { ...customer("Leo Wik", "web"), is_temporary: true })

    // A booking group: two haircuts at the same time.
    const group = put(
      db.bookingGroups,
      stamp({ id: uuid(), metadata: { party: "Lindqvist", note: "Siblings, book together" }, protected_metadata: null })
    )
    d = businessDay(9)
    for (const [resource, name] of [
      [anna, "Alva Lindqvist"],
      [ben, "Elias Lindqvist"],
    ]) {
      book(resource, haircut, sthlm, d, "10:00:00", d, "10:45:00", customer(name, "web")).booking_group_id = group.id
    }
  } finally {
    seedClock = null
  }
}

// ---------------------------------------------------------------------------
// HTTP server

let rateWindow = 0
let rateCount = 0

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on("data", (c) => {
      size += c.length
      if (size > 1_000_000) {
        reject(new HttpError(413, { message: "Payload too large." }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

async function handle(req) {
  const url = req.url ?? "/"
  const qIndex = url.indexOf("?")
  const pathname = (qIndex < 0 ? url : url.slice(0, qIndex)).replace(/\/+$/, "") || "/"
  const rawQuery = qIndex < 0 ? "" : url.slice(qIndex + 1)
  const method = (req.method ?? "GET").toUpperCase()

  // Test helpers (no auth, outside /v1).
  if (pathname === "/__health") {
    return respond({ ok: true, now: currentNow === null ? null : new Date(currentNow).toISOString(), seed: currentSeed })
  }
  if (pathname === "/__reset" && method === "POST") {
    const params = new URLSearchParams(rawQuery)
    try {
      currentNow = params.has("now") ? parseNow(params.get("now"), "now") : BASE_NOW
      currentSeed = params.has("seed") ? parseSeed(params.get("seed"), "seed") : BASE_SEED
    } catch (error) {
      return respond({ message: error.message }, 400)
    }
    seed.empty = /^(1|true)$/.test(params.get("empty") ?? "")
    seed()
    seed.empty = false
    rateWindow = 0
    rateCount = 0
    return respond({ now: currentNow === null ? null : new Date(currentNow).toISOString(), seed: currentSeed })
  }

  // Rate limit (per minute window).
  const windowId = Math.floor(Date.now() / MINUTE)
  if (windowId !== rateWindow) {
    rateWindow = windowId
    rateCount = 0
  }
  rateCount++
  const headers = {
    "X-RateLimit-Limit": String(RATE_LIMIT),
    "X-RateLimit-Remaining": String(Math.max(0, RATE_LIMIT - rateCount)),
  }
  if (rateCount > RATE_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil(((windowId + 1) * MINUTE - Date.now()) / SECOND))
    throw new HttpError(429, { message: "Too Many Attempts." }, { ...headers, "Retry-After": String(retryAfter) })
  }

  const withHeaders = (fn) => {
    try {
      return { ...fn(), headers }
    } catch (e) {
      if (e instanceof HttpError) e.headers = { ...headers, ...e.headers }
      throw e
    }
  }

  return withHeaders(() => {
    const auth = req.headers.authorization ?? ""
    if (!/^Bearer\s+\S+/i.test(auth)) throw new HttpError(401, { message: "Unauthenticated." })
    if (pathname !== BASE && !pathname.startsWith(`${BASE}/`)) throw notFound()

    let segments
    try {
      segments = pathname.slice(BASE.length).split("/").filter(Boolean).map(decodeURIComponent)
    } catch {
      throw notFound()
    }
    const match = matchRoute(method, segments)
    if (match === null) throw notFound()
    if (match === "method-not-allowed") {
      throw new HttpError(405, { message: `The ${method} method is not supported for this route.` })
    }
    return match.handler({
      method,
      pathname,
      params: match.params,
      query: parseQuery(rawQuery),
      body: req.parsedBody,
      origin: `http://${req.headers.host ?? `${HOST}:${PORT}`}`,
    })
  })
}

const server = http.createServer(async (req, res) => {
  const started = Date.now()
  let status = 500
  let payload = null
  let headers = {}
  try {
    const text = await readBody(req)
    req.parsedBody = {}
    if (["POST", "PUT", "PATCH"].includes(req.method) && text.trim()) {
      try {
        req.parsedBody = JSON.parse(text)
      } catch {
        throw new HttpError(400, { message: "The request body is not valid JSON." })
      }
      if (!isPlainObject(req.parsedBody)) {
        throw new HttpError(400, { message: "The request body must be a JSON object." })
      }
    }
    const result = await handle(req)
    status = result.status
    payload = result.body ?? null
    headers = result.headers ?? {}
  } catch (e) {
    if (e instanceof HttpError) {
      status = e.status
      payload = e.body
      headers = e.headers
    } else {
      console.error(e)
      status = 500
      payload = { message: "Server Error" }
    }
  }
  if (status === 204 || payload === null) {
    res.writeHead(status, headers)
    res.end()
  } else {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      ...headers,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    })
    res.end(body)
  }
  if (LOG) console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.url} ${status} ${Date.now() - started}ms`)
})

seed()
server.listen(PORT, HOST, () => {
  const counts = `${db.locations.size} locations, ${db.resources.size} resources, ${db.services.size} services, ${db.bookings.size} bookings, ${db.bookingGroups.size} booking groups`
  console.log(`Mock Hapio API listening on http://${HOST}:${PORT}${BASE} (${counts})`)
  console.log(`Use HAPIO_BASE_URL=http://${HOST}:${PORT}${BASE} and any non-empty HAPIO_API_TOKEN.`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close()
    process.exit(0)
  })
}
