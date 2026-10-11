import { expect, type Locator, type Page } from "@playwright/test"

import type { HapioApi, Json } from "../fixtures/hapio-api"
import { SEED } from "../fixtures/seed"

// Helpers for the booking-groups specs only.

export interface Entity {
  id: string
  name: string
}

export interface GroupBooking {
  id: string
  service: Entity | null
  location: (Entity & { time_zone: string }) | null
  resource: Entity | null
  price: string | null
  metadata: Json | null
  protected_metadata?: Json | null
  is_temporary: boolean
  is_canceled: boolean
  starts_at: string
  ends_at: string
  buffer_starts_at: string
  buffer_ends_at: string
  finalized_at: string | null
  canceled_at: string | null
}

export interface Group {
  id: string
  bookings: GroupBooking[]
  metadata: Json | null
  protected_metadata?: Json | null
  created_at: string
  updated_at: string
}

export const short = (id: string) => id.slice(0, 8)

const instant = (iso: string) => new Date(iso).getTime()

/** Bookings in the order the panel shows them: a stable sort by start instant. */
export const byStart = <T extends { starts_at: string }>(bookings: readonly T[]) =>
  [...bookings].sort((a, b) => instant(a.starts_at) - instant(b.starts_at))

export const customerOf = (booking: { metadata: Json | null }) =>
  (booking.metadata?.customer as { name?: string } | undefined)?.name

/** The seed's only booking group (the Lindqvist siblings). */
export async function seedGroup(api: HapioApi): Promise<Group> {
  const groups = await api.list<Group>("booking-groups")
  expect(groups, "the seed has exactly one booking group").toHaveLength(1)
  return groups[0]
}

export async function getGroup(api: HapioApi, id: string) {
  return api.get<Group>(`booking-groups/${id}`)
}

/** Ids of the seed entities the specs book with. */
export async function seedIds(api: HapioApi) {
  const [haircut, studio, stockholm, newYork, anna, ben, roomA] = await Promise.all([
    api.idOf("services", SEED.services.haircut.name),
    api.idOf("services", SEED.services.studio.name),
    api.idOf("locations", SEED.locations.stockholm.name),
    api.idOf("locations", SEED.locations.newYork.name),
    api.idOf("resources", SEED.resources.anna.name),
    api.idOf("resources", SEED.resources.ben.name),
    api.idOf("resources", SEED.resources.roomA.name),
  ])
  return { haircut, studio, stockholm, newYork, anna, ben, roomA }
}

/** Removes every booking from a group through the API, leaving it empty. */
export async function emptyTheGroup(api: HapioApi, group: Group) {
  for (const booking of group.bookings) await api.delete(`bookings/${booking.id}`)
}

/**
 * Pages without other API content: waits for the sidebar's project name, which
 * only renders once the client has hydrated and fetched the project.
 */
export async function expectHydrated(page: Page) {
  await expect(page.getByText(SEED.project, { exact: true })).toBeVisible()
}

/** One booking row ("Booking N") of the group form. */
export function bookingRow(scope: Page | Locator, n: number) {
  return scope.getByRole("group", { name: `Booking ${n}`, exact: true })
}

/** The controls inside a booking row of the group form. */
export function rowFields(row: Locator) {
  return {
    service: row.getByRole("combobox", { name: "Service", exact: true }),
    location: row.getByRole("combobox", { name: "Location", exact: true }),
    resource: row.getByRole("combobox", { name: "Resource", exact: true }),
    starts: row.getByLabel("Starts", { exact: true }),
    ends: row.getByLabel("Ends", { exact: true }),
    price: row.getByRole("textbox", { name: "Price", exact: true }),
    temporary: row.getByRole("switch", { name: "Temporary", exact: true }),
    canceled: row.getByRole("switch", { name: "Canceled", exact: true }),
    /** The row's "Hapio rejected this booking" alert. */
    alert: row.getByRole("alert").filter({ hasText: "Hapio rejected this booking" }),
  }
}

/** The value of an item in a detail list ("Span", "Status", …). */
export function detailValue(page: Page, label: string) {
  return page
    .getByRole("main")
    .locator("dl > div")
    .filter({ has: page.locator("dt").getByText(label, { exact: true }) })
    .locator("dd")
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** A timestamp as the panel shows it with its offset: "20 Oct 2026, 06:00 (UTC)". */
export function formatStamp(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(iso)
  if (!m) throw new Error(`Unexpected timestamp ${iso}`)
  const [, y, mo, d, h, mi, offset] = m
  const suffix = offset === "Z" || offset === "+00:00" ? "UTC" : `UTC${offset}`
  return `${Number(d)} ${MONTHS[Number(mo) - 1]} ${y}, ${h}:${mi} (${suffix})`
}

/**
 * `page.clock.install` (done by the `page` fixture) swaps `Date` for a fake that can't be
 * subclassed: `new (class extends Date {})()` returns a plain Date. @date-fns/tz's TZDate
 * then silently works in the browser's zone, so wall times in another zone (New York)
 * come out wrong. This init script makes the fake subclassable again; call it before
 * `goto` in tests that enter times outside Europe/Stockholm.
 */
export async function allowDateSubclasses(page: Page) {
  await page.addInitScript(() => {
    const ClockDate = Date
    const Subclassable = new Proxy(ClockDate, {
      construct(target, args, newTarget) {
        const date = Reflect.construct(target, args)
        if (newTarget !== Subclassable) Object.setPrototypeOf(date, newTarget.prototype)
        return date
      },
    })
    window.Date = Subclassable
  })
}
