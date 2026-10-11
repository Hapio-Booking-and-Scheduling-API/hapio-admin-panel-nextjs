import type { Locator, Page } from "@playwright/test"

import type { HapioApi, Json } from "../fixtures/hapio-api"
import { expect, test as base } from "../fixtures/test"

/**
 * Playwright's fake clock (installed by the shared `page` fixture) replaces `Date` with a
 * constructor that returns a plain native Date, so `class X extends Date` loses its
 * prototype. @date-fns/tz's TZDate is such a subclass: without this fix every
 * location-zone conversion in the browser silently falls back to the browser's zone
 * (Europe/Stockholm), e.g. a New York day range is sent as `06:00:00+02:00` instead of
 * `00:00:00-04:00`. Real browsers don't have this problem. This init script makes the fake
 * `Date` subclassable again while keeping the fixed clock.
 */
function makeFakeDateSubclassable() {
  type DateCtor = DateConstructor & { isFake?: boolean; __subclassable?: boolean }
  const w = window as unknown as { Date: DateCtor }
  const wrap = (ClockDate: DateCtor): DateCtor => {
    if (!ClockDate || !ClockDate.isFake || ClockDate.__subclassable) return ClockDate
    const Patched = function (this: unknown, ...args: unknown[]) {
      if (!new.target) return (ClockDate as unknown as (...a: unknown[]) => string)(...args)
      const date = Reflect.construct(ClockDate, args) as Date
      if (new.target !== Patched) Object.setPrototypeOf(date, new.target.prototype)
      return date
    } as unknown as DateCtor
    for (const key of Object.getOwnPropertyNames(ClockDate)) {
      if (["length", "name", "prototype", "arguments", "caller"].includes(key)) continue
      try {
        ;(Patched as unknown as Record<string, unknown>)[key] = (ClockDate as unknown as Record<string, unknown>)[key]
      } catch {}
    }
    ;(Patched as unknown as { prototype: Date }).prototype = ClockDate.prototype
    Patched.__subclassable = true
    return Patched
  }
  if (w.Date.isFake) {
    w.Date = wrap(w.Date)
    return
  }
  // The clock isn't installed yet: patch it when it replaces Date.
  let current = w.Date
  Object.defineProperty(window, "Date", {
    configurable: true,
    get: () => current,
    set: (value: DateCtor) => {
      current = wrap(value)
    },
  })
}

/** The shared fixtures, plus a fake clock that keeps TZDate working (see above). */
export const test = base.extend<{ subclassableDate: void }>({
  subclassableDate: [
    async ({ page }, provide) => {
      await page.addInitScript(makeFakeDateSubclassable)
      await provide()
    },
    { auto: true },
  ],
})

export { expect }

export type ApiBooking = Json & {
  id: string
  starts_at: string
  ends_at: string
  buffer_starts_at: string
  buffer_ends_at: string
  price: string | null
  metadata: Json | null
  protected_metadata?: Json | null
  is_temporary: boolean
  is_canceled: boolean
  finalized_at: string | null
  canceled_at: string | null
  resource: { id: string; name: string } | null
  service: { id: string; name: string } | null
  location: { id: string; name: string; time_zone: string } | null
  booking_group: { id: string } | null
}

export const shortId = (id: string) => id.slice(0, 8)

/** The seed booking for a customer, typed. */
export async function seedBooking(api: HapioApi, customer: string): Promise<ApiBooking> {
  return (await api.bookingFor(customer)) as ApiBooking
}

/** The bookings list row whose actions menu belongs to this booking. */
export function bookingRow(page: Page, id: string): Locator {
  return page
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: `Actions for booking ${shortId(id)}`, exact: true }) })
}

/** Opens a booking row's actions menu and picks an item. */
export async function bookingRowAction(page: Page, id: string, item: string) {
  await page.getByRole("button", { name: `Actions for booking ${shortId(id)}`, exact: true }).click()
  await page.getByRole("menuitem", { name: item, exact: true }).click()
}

/** The menu items offered for a booking row (opens the menu, reads, closes it). */
export async function bookingRowActionNames(page: Page, id: string): Promise<string[]> {
  await page.getByRole("button", { name: `Actions for booking ${shortId(id)}`, exact: true }).click()
  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  const names = (await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim())
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
  return names
}

/** Data rows of the first table in main. */
export function dataRows(page: Page): Locator {
  return page.getByRole("main").getByRole("table").first().locator("tbody tr")
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const pageOf = (scope: Page | Locator): Page => ("page" in scope && typeof scope.page === "function" ? scope.page() : (scope as Page))

/** A form field (label + control + description + error) by its exact label text. */
export function field(scope: Page | Locator, label: string): Locator {
  const labelEl = pageOf(scope).locator('[data-slot="field-label"]').filter({ hasText: new RegExp(`^${escapeRe(label)}$`) })
  return scope.locator('[data-slot="field"]').filter({ has: labelEl })
}

/** The inline error of a form field. */
export function fieldError(scope: Page | Locator, label: string): Locator {
  return field(scope, label).locator('[data-slot="field-error"]')
}

/** Controls of the booking form (create page or edit dialog). */
export function bookingForm(scope: Page | Locator) {
  return {
    service: scope.getByRole("combobox", { name: "Service", exact: true }),
    location: scope.getByRole("combobox", { name: "Location", exact: true }),
    resource: scope.getByRole("combobox", { name: "Resource", exact: true }),
    starts: scope.getByLabel("Starts", { exact: true }),
    ends: scope.getByLabel("Ends", { exact: true }),
    autoPrice: scope.getByRole("switch", { name: "Calculate price automatically" }),
    price: scope.getByLabel("Price", { exact: true }),
    temporary: scope.getByRole("switch", { name: "Temporary", exact: true }),
    canceled: scope.getByRole("switch", { name: "Canceled", exact: true }),
    group: scope.getByLabel("Booking group", { exact: true }),
    clearGroup: scope.getByRole("button", { name: "Clear group" }),
    recentGroups: scope.getByRole("button", { name: "Pick a recent booking group" }),
    metadata: scope.getByLabel("Metadata", { exact: true }),
    protectedMetadata: scope.getByLabel("Protected metadata", { exact: true }),
    overrideRules: scope.getByRole("button", { name: /^Override rules/ }),
    customBuffers: scope.getByRole("button", { name: /^Custom buffers/ }),
    flag: (label: string) => scope.getByRole("switch", { name: label, exact: true }),
    setBuffers: scope.getByRole("switch", { name: "Set buffers manually" }),
    bufferStarts: scope.getByLabel("Buffer starts", { exact: true }),
    bufferEnds: scope.getByLabel("Buffer ends", { exact: true }),
  }
}

/** The visible popover (date range, advanced filters, pickers). */
export function popover(page: Page): Locator {
  return page.locator('[data-slot="popover-content"]').last()
}

/** The date range filter trigger, whatever its current label. */
export function dateRangeTrigger(page: Page): Locator {
  return page.getByRole("button", { name: /^Date range: / })
}

/** Picks a preset (or "All dates") from the date range filter. */
export async function pickDateRange(page: Page, preset: string) {
  await dateRangeTrigger(page).click()
  const pop = popover(page)
  await expect(pop).toBeVisible()
  await pop.getByRole("button", { name: preset, exact: true }).click()
  await expect(pop).toBeHidden()
}

/** Expected PUT body for a booking, as the JSON tab should prefill it. */
export function expectedPutBody(b: ApiBooking) {
  const body: Json = {
    resource_id: b.resource?.id ?? null,
    service_id: b.service?.id ?? null,
    location_id: b.location?.id ?? null,
    booking_group_id: b.booking_group?.id ?? null,
    price: b.price,
    metadata: b.metadata,
    is_temporary: b.is_temporary,
    is_canceled: b.is_canceled,
    starts_at: b.starts_at,
    ends_at: b.ends_at,
    buffer_starts_at: b.buffer_starts_at,
    buffer_ends_at: b.buffer_ends_at,
  }
  if (b.protected_metadata !== undefined) body.protected_metadata = b.protected_metadata
  return body
}

/**
 * Delays the RSC requests of client-side navigations (and prefetches) to `pathname`,
 * like a slow connection would. Exposes races between a mutation's refetch and the
 * navigation that follows it.
 */
export async function slowNavigationTo(page: Page, pathname: string, ms = 1_500) {
  await page.route(
    (url) => url.pathname === pathname && url.searchParams.has("_rsc"),
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      await route.fallback()
    }
  )
}
