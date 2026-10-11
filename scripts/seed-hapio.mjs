#!/usr/bin/env node
// Optional: fill a Hapio project with demo data, so every page of the admin panel has
// something to show. Uses the same demo story as `npm run mock`.
//
//   npm run seed                 # asks before writing anything
//   npm run seed -- --yes        # don't ask
//   npm run seed -- --dry-run    # show what would be created, write nothing
//   npm run seed -- --clean      # delete everything this script created
//
// Reads HAPIO_API_TOKEN and HAPIO_BASE_URL from the environment, .env.local or .env. Every record
// it creates has metadata.seed = "hapio-admin-demo", which is how --clean finds it again.
// Single file, no dependencies (Node 22+).

import { existsSync } from "node:fs"
import { createInterface } from "node:readline/promises"

const SEED_TAG = "hapio-admin-demo"
const DEFAULT_BASE_URL = "https://eu-central-1.hapio.net/v1"

const args = new Set(process.argv.slice(2))
const YES = args.has("--yes") || args.has("-y")
const DRY_RUN = args.has("--dry-run")
const CLEAN = args.has("--clean")

if (args.has("--help") || args.has("-h")) {
  console.log(
    [
      "Usage: npm run seed -- [--yes] [--dry-run] [--clean]",
      "",
      "  --yes      don't ask for confirmation",
      "  --dry-run  show what would happen, write nothing",
      "  --clean    delete the demo data this script created",
    ].join("\n")
  )
  process.exit(0)
}

// Same files as Next.js; values already set (shell, then .env.local) win.
for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file)
const TOKEN = process.env.HAPIO_API_TOKEN
const BASE_URL = (process.env.HAPIO_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "")
if (!TOKEN) {
  console.error("HAPIO_API_TOKEN is not set. Add it to .env.local or .env (see .env.example).")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// HTTP

class ApiError extends Error {
  constructor(status, method, path, body) {
    const details = body?.errors
      ? Object.entries(body.errors)
          .map(([field, messages]) => `\n    ${field}: ${[].concat(messages).join(" ")}`)
          .join("")
      : ""
    super(`${method} ${path} → ${status} ${body?.message ?? ""}${details}`)
    this.status = status
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function api(method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE_URL}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get("retry-after")) || 2 ** attempt * 5
      console.log(`  Rate limited, waiting ${wait}s…`)
      await sleep(wait * 1000)
      continue
    }
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = { message: text.slice(0, 200) }
    }
    if (!res.ok) throw new ApiError(res.status, method, path, json)
    return json
  }
}

/** All items of a paginated list endpoint. `query` is a raw query string. */
async function listAll(path, query = "") {
  const items = []
  for (let page = 1; ; page++) {
    const res = await api("GET", `${path}?${query ? `${query}&` : ""}per_page=100&page=${page}`)
    items.push(...res.data)
    if (!res.meta || page >= res.meta.last_page) return items
  }
}

// Hapio requires an operator on metadata filters; `seq` is string equality.
const seeded = `metadata[seed][seq]=${SEED_TAG}`

// ---------------------------------------------------------------------------
// Time (ported from scripts/mock-hapio.mjs)

const SECOND = 1000
const MINUTE = 60 * SECOND
const DAY = 24 * 60 * MINUTE
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const pad = (n, w = 2) => String(n).padStart(w, "0")

/** UTC offset of `tz` at instant `ms`, in minutes. */
function tzOffset(ms, tz) {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(new Date(ms))
      .find((p) => p.type === "timeZoneName")?.value ?? ""
  const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(name)
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0
}

const dateOfDayNum = (n) => new Date(n * DAY).toISOString().slice(0, 10)
/** 0 = Monday … 6 = Sunday. */
const weekdayIdx = (n) => (((n + 3) % 7) + 7) % 7
/** Epoch ms → local day number in `tz`. */
const localDayNum = (ms, tz) => Math.floor((ms + tzOffset(ms, tz) * MINUTE) / DAY)

/** Wall-clock time in `tz` → epoch ms. */
function wallToMs(dayNum, time, tz) {
  const [h, mi, s] = time.split(":").map(Number)
  const guess = dayNum * DAY + ((h * 60 + mi) * 60 + s) * SECOND
  const first = guess - tzOffset(guess, tz) * MINUTE
  return guess - tzOffset(first, tz) * MINUTE
}

/** Epoch ms → `YYYY-MM-DDThh:mm:ss±hh:mm` in `tz`. */
function fmt(ms, tz) {
  const off = tzOffset(ms, tz)
  const d = new Date(ms + off * MINUTE)
  const abs = Math.abs(off)
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `${off < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

// ---------------------------------------------------------------------------
// Helpers

async function confirm(question) {
  if (YES || DRY_RUN) return true
  if (!process.stdin.isTTY) {
    console.error("Not a terminal, so I can't ask. Rerun with --yes to continue.")
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`${question} [y/N] `)
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

const tag = (metadata = {}) => ({ ...metadata, seed: SEED_TAG })

const counts = {}
let fakeIds = 0

/** POST/PUT/PATCH that is skipped (with a fake id) in --dry-run mode. */
async function create(kind, label, method, path, body) {
  counts[kind] = (counts[kind] ?? 0) + 1
  if (DRY_RUN) {
    console.log(`  would create ${kind}: ${label}`)
    return { id: `dry-run-${++fakeIds}`, ...body }
  }
  const record = await api(method, path, body)
  console.log(`  created ${kind}: ${label}`)
  return record
}

// ---------------------------------------------------------------------------
// Seed

async function seed() {
  const existing = await listAll("locations", seeded)
  if (existing.length) {
    console.error(
      `\nThis project already has demo data (${existing.length} location(s) tagged "${SEED_TAG}").` +
        "\nRun `npm run seed -- --clean` first to remove it."
    )
    process.exit(1)
  }

  console.log(
    [
      "",
      "This creates demo data in the project above:",
      "  • 2 locations (Stockholm, New York)",
      "  • 3 resources (Anna, Ben, Room A) with weekday schedules and a few blocked hours",
      "  • 3 services (fixed, flexible and day) linked to the resources",
      "  • about 12 bookings (past, upcoming, temporary, canceled) and 1 booking group",
      `Everything is tagged metadata.seed = "${SEED_TAG}" and can be removed with --clean.`,
      "",
    ].join("\n")
  )
  if (!(await confirm("Create the demo data?"))) return console.log("Nothing created.")
  console.log("")

  // Locations
  const sthlm = await create("location", "Stockholm Studio", "POST", "locations", {
    name: "Stockholm Studio",
    time_zone: "Europe/Stockholm",
    resource_selection_strategy: "prioritize",
    metadata: tag({ address: "Götgatan 12, Stockholm", floor: 2 }),
  })
  const ny = await create("location", "New York Loft", "POST", "locations", {
    name: "New York Loft",
    time_zone: "America/New_York",
    resource_selection_strategy: "randomize",
    metadata: tag({ address: "120 Wooster St, New York", floor: 5 }),
  })

  // Resources
  const resource = (body) => create("resource", body.name, "POST", "resources", body)
  const anna = await resource({ name: "Anna", metadata: tag({ role: "stylist", level: 3 }) })
  const ben = await resource({ name: "Ben", metadata: tag({ role: "stylist", level: 2 }) })
  const roomA = await resource({
    name: "Room A",
    max_simultaneous_bookings: 2,
    metadata: tag({ role: "room", capacity: 6 }),
  })
  if (!DRY_RUN) {
    await api("PATCH", `locations/${sthlm.id}`, { resource_selection_priority: [anna.id, ben.id, roomA.id] })
    console.log("  set Stockholm Studio's resource priority: Anna, Ben, Room A")
  }

  // Services
  const service = (body) => create("service", body.name, "POST", "services", body)
  const haircut = await service({
    name: "Haircut",
    type: "fixed",
    duration: "PT45M",
    price: "450.000",
    buffer_time_after: "PT15M",
    metadata: tag({ category: "hair" }),
  })
  const studio = await service({
    name: "Studio rental",
    type: "flexible",
    min_duration: "PT1H",
    max_duration: "PT4H",
    duration_step: "PT30M",
    price: "300.000",
    metadata: tag({ category: "space" }),
  })
  const equipment = await service({
    name: "Equipment rental",
    type: "day",
    start_time: "09:00:00",
    end_time: "17:00:00",
    min_days: 1,
    max_days: 7,
    price: "150.000",
    metadata: tag({ category: "equipment" }),
  })

  const associate = (r, s) =>
    create("resource–service link", `${r.name} ↔ ${s.name}`, "PUT", `resources/${r.id}/services/${s.id}`)
  for (const r of [anna, ben, roomA]) {
    await associate(r, haircut)
    await associate(r, studio)
  }
  await associate(roomA, equipment)

  // Schedules: Mon–Fri 09:00–17:00, starting 30 days ago.
  const tz = sthlm.time_zone
  const now = Date.now()
  const today = localDayNum(now, tz)
  const weekdaySchedule = async (r, location) => {
    const rs = await create(
      "recurring schedule",
      `${r.name} @ ${location.name}`,
      "POST",
      `resources/${r.id}/recurring-schedules`,
      { location_id: location.id, start_date: dateOfDayNum(today - 30) }
    )
    for (const weekday of WEEKDAYS.slice(0, 5)) {
      await create(
        "recurring schedule block",
        `${r.name} @ ${location.name}, ${weekday} 09–17`,
        "POST",
        `resources/${r.id}/recurring-schedules/${rs.id}/schedule-blocks`,
        { weekday, start_time: "09:00:00", end_time: "17:00:00" }
      )
    }
  }
  await weekdaySchedule(anna, sthlm)
  await weekdaySchedule(anna, ny)
  await weekdaySchedule(ben, sthlm)
  await weekdaySchedule(roomA, sthlm)

  // One-off unavailable blocks next week.
  const at = (dayNum, time, zone = tz) => fmt(wallToMs(dayNum, time, zone), zone)
  const nextMonday = today - weekdayIdx(today) + 7
  const block = (r, dayOffset, start, end, label) =>
    create("schedule block", `${r.name} unavailable ${label}`, "POST", `resources/${r.id}/schedule-blocks`, {
      location_id: sthlm.id,
      starts_at: at(nextMonday + dayOffset, start),
      ends_at: at(nextMonday + dayOffset, end),
      is_available: false,
    })
  await block(anna, 2, "12:00:00", "14:00:00", "next Wednesday lunch")
  await block(ben, 1, "09:00:00", "12:00:00", "next Tuesday morning")
  await block(roomA, 3, "13:00:00", "17:00:00", "next Thursday afternoon")

  // Bookings
  const businessDay = (n) => {
    let d = today
    for (let left = Math.abs(n); left > 0; ) {
      d += Math.sign(n)
      if (weekdayIdx(d) < 5) left--
    }
    return d
  }
  const customer = (name, source, more = {}) =>
    tag({ customer: { name, email: `${name.split(" ")[0].toLowerCase()}@example.com` }, source, ...more })
  const bookingBody = (r, s, location, day, start, endDay, end, extra = {}) => ({
    resource_id: r.id,
    service_id: s.id,
    location_id: location.id,
    starts_at: at(day, start, location.time_zone),
    ends_at: at(endDay, end, location.time_zone),
    ...extra,
  })
  // A rejected booking (e.g. the slot isn't open in this project, or the token lacks an
  // ability) is skipped with a warning, so the rest of the demo data still gets created.
  const skipped = []
  const tryCreate = async (kind, label, path, body) => {
    try {
      return await create(kind, label, "POST", path, body)
    } catch (error) {
      if (!(error instanceof ApiError && (error.status === 403 || error.status === 422))) throw error
      counts[kind]--
      skipped.push({ kind, label, past: Boolean(body.ignore_booking_window) })
      console.log(`  skipped ${kind}: ${label}\n    ${error.message}`)
      return null
    }
  }
  const book = (r, s, location, day, start, endDay, end, extra = {}) => {
    const body = bookingBody(r, s, location, day, start, endDay, end, extra)
    const label = `${s.name} with ${r.name}, ${body.starts_at.slice(0, 16).replace("T", " ")} (${extra.metadata.customer.name})`
    return tryCreate("booking", label, "bookings", body)
  }
  const past = { ignore_booking_window: true }

  // Past
  let d = businessDay(-5)
  await book(anna, haircut, sthlm, d, "10:00:00", d, "10:45:00", { ...past, metadata: customer("Maja Holm", "phone") })
  d = businessDay(-4)
  await book(ben, haircut, sthlm, d, "14:00:00", d, "14:45:00", { ...past, metadata: customer("Oskar Berg", "web") })
  d = businessDay(-3)
  await book(roomA, studio, sthlm, d, "10:00:00", d, "12:00:00", {
    ...past,
    metadata: customer("Lumen Collective", "web"),
  })

  // Upcoming
  d = businessDay(1)
  await book(anna, haircut, sthlm, d, "09:00:00", d, "09:45:00", { metadata: customer("Erik Lund", "web", { vip: true }) })
  await book(ben, haircut, sthlm, d, "14:00:00", d, "14:45:00", { metadata: customer("Nora Falk", "phone") })
  d = businessDay(2)
  await book(roomA, studio, sthlm, d, "09:30:00", d, "11:30:00", { metadata: customer("Pixel & Co", "web") })
  // One day: Hapio requires the whole span to be open, and Room A is closed overnight.
  d = businessDay(3)
  await book(roomA, equipment, sthlm, d, "09:00:00", d, "17:00:00", {
    metadata: customer("Fotostudion AB", "email"),
  })
  const canceled = await book(anna, haircut, sthlm, d, "15:00:00", d, "15:45:00", { metadata: customer("Sara Ek", "web") })
  if (canceled && !DRY_RUN) {
    await api("PATCH", `bookings/${canceled.id}`, { is_canceled: true })
    console.log("  canceled Sara Ek's booking")
  }
  d = businessDay(4)
  await book(anna, haircut, sthlm, d, "10:00:00", d, "10:45:00", {
    is_temporary: true,
    metadata: customer("Ida Strand", "web"),
  })
  d = businessDay(6)
  await book(anna, haircut, ny, d, "10:00:00", d, "10:45:00", { metadata: customer("Jamie Carter", "web") })
  d = businessDay(8)
  await book(ben, haircut, sthlm, d, "15:00:00", d, "15:45:00", {
    is_temporary: true,
    metadata: customer("Leo Wik", "web"),
  })

  // A booking group: two haircuts at the same time.
  d = businessDay(9)
  await tryCreate("booking group", "Lindqvist siblings (2 haircuts)", "booking-groups", {
    metadata: tag({ party: "Lindqvist", note: "Siblings, book together" }),
    bookings: [
      [anna, "Alva Lindqvist"],
      [ben, "Elias Lindqvist"],
    ].map(([r, name]) =>
      bookingBody(r, haircut, sthlm, d, "10:00:00", d, "10:45:00", { metadata: customer(name, "web") })
    ),
  })

  console.log(`\n${DRY_RUN ? "Would create" : "Created"}:`)
  for (const [kind, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(3)} × ${kind}`)
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} booking(s) that Hapio rejected; the reasons are listed above.`)
    if (skipped.some((s) => s.past)) {
      console.log("Bookings in the past need the booking:ignore_booking_window ability on the token.")
    }
  }
  if (!DRY_RUN) {
    console.log(
      "\nStart the panel with `npm run dev` and open http://127.0.0.1:3000." +
        "\nRemove the demo data again with `npm run seed -- --clean`."
    )
  }
}

// ---------------------------------------------------------------------------
// Clean

async function clean() {
  const [groups, bookings, resources, services, locations] = await Promise.all([
    listAll("booking-groups", seeded),
    listAll("bookings", `${seeded}&temporary=include&canceled=include`),
    listAll("resources", seeded),
    listAll("services", seeded),
    listAll("locations", seeded),
  ])
  const total = groups.length + bookings.length + resources.length + services.length + locations.length
  if (!total) return console.log(`\nNo demo data found (nothing tagged metadata.seed = "${SEED_TAG}").`)

  console.log(
    [
      "",
      "This deletes the demo data from the project above:",
      `  • ${groups.length} booking group(s)`,
      `  • ${bookings.length} booking(s)`,
      `  • ${resources.length} resource(s) with their schedules`,
      `  • ${services.length} service(s)`,
      `  • ${locations.length} location(s)`,
      "",
    ].join("\n")
  )
  if (!(await confirm("Delete the demo data?"))) return console.log("Nothing deleted.")
  console.log("")

  const remove = async (kind, label, path) => {
    if (DRY_RUN) return console.log(`  would delete ${kind}: ${label}`)
    try {
      await api("DELETE", path)
      console.log(`  deleted ${kind}: ${label}`)
    } catch (error) {
      // Already gone, e.g. a booking deleted together with its group.
      if (!(error instanceof ApiError && error.status === 404)) throw error
    }
  }

  for (const g of groups) await remove("booking group", g.id, `booking-groups/${g.id}`)
  for (const b of bookings) await remove("booking", `${b.metadata?.customer?.name ?? b.id}`, `bookings/${b.id}`)
  for (const r of resources) {
    for (const rs of await listAll(`resources/${r.id}/recurring-schedules`)) {
      await remove("recurring schedule", `${r.name} @ ${rs.location_id}`, `resources/${r.id}/recurring-schedules/${rs.id}`)
    }
    for (const sb of await listAll(`resources/${r.id}/schedule-blocks`)) {
      await remove("schedule block", `${r.name} ${sb.starts_at}`, `resources/${r.id}/schedule-blocks/${sb.id}`)
    }
    await remove("resource", r.name, `resources/${r.id}`)
  }
  for (const s of services) await remove("service", s.name, `services/${s.id}`)
  for (const l of locations) await remove("location", l.name, `locations/${l.id}`)

  console.log(DRY_RUN ? "\nDry run: nothing was deleted." : "\nDemo data removed.")
}

// ---------------------------------------------------------------------------
// Main

try {
  const project = await api("GET", "project")
  console.log(`Hapio project: ${project.name} (${BASE_URL})${DRY_RUN ? " — dry run, nothing is written" : ""}`)
  await (CLEAN ? clean() : seed())
} catch (error) {
  console.error(`\n${error instanceof ApiError ? "Hapio returned an error:\n  " : ""}${error.message}`)
  if (error instanceof ApiError && error.status === 401) console.error("Check HAPIO_API_TOKEN.")
  if (error instanceof ApiError && error.status === 403) {
    console.error("The token is missing an ability for this request. Add it in the Hapio portal.")
  }
  process.exit(1)
}
