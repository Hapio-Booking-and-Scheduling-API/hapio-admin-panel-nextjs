import { expect, type Locator, type Page } from "@playwright/test"

import type { HapioApi, Json } from "../fixtures/hapio-api"
import { exactly } from "../helpers/ui"

export type ServiceName = "Haircut" | "Studio rental" | "Equipment rental"

export interface ServiceJson extends Json {
  id: string
  name: string
  type: "fixed" | "flexible" | "day"
}

/** Opens a service's detail page (optionally on a tab) and waits for its name. */
export async function gotoService(page: Page, api: HapioApi, name: string, tab?: "resources" | "slots" | "json") {
  const service = await api.byName<ServiceJson>("services", name)
  await page.goto(`/services/${service.id}${tab ? `?tab=${tab}` : ""}`)
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
  return service
}

/** `has:` locators are matched inside each candidate, so they must start from the page. */
const pageOf = (scope: Page | Locator): Page => ("goto" in scope ? scope : scope.page())

/** A SectionCard / Card by its title. */
export function card(scope: Page | Locator, title: string | RegExp) {
  const text = typeof title === "string" ? exactly(title) : title
  return scope.locator('[data-slot="card"]').filter({
    has: pageOf(scope).locator('[data-slot="card-title"]').filter({ hasText: text }),
  })
}

/** A form Field (label + control + description + error) by its visible label. */
export function field(scope: Page | Locator, label: string | RegExp) {
  const text = typeof label === "string" ? exactly(label) : label
  return scope.locator('[data-slot="field"]').filter({
    has: pageOf(scope).locator('[data-slot="field-label"]').filter({ hasText: text }),
  })
}

/** The inline validation message of a field. */
export function fieldError(scope: Page | Locator, label: string | RegExp) {
  return field(scope, label).locator('[data-slot="field-error"]')
}

/**
 * A duration editor labelled `label`. For optional durations (with a null switch)
 * this is the outer group containing the switch and the editor.
 */
export function durationGroup(scope: Page | Locator, label: string) {
  return scope.getByRole("group", { name: label, exact: true }).first()
}

/** Sets the simple-editor parts of a duration editor (only the given units). */
export async function setDuration(
  scope: Page | Locator,
  label: string,
  parts: Partial<Record<"Days" | "Hours" | "Minutes", number>>
) {
  const group = durationGroup(scope, label)
  for (const [unit, n] of Object.entries(parts)) {
    await group.getByRole("spinbutton", { name: unit }).fill(String(n))
  }
}

/** Switches a duration editor to raw ISO 8601 mode and types `value`. */
export async function setRawDuration(scope: Page | Locator, label: string, value: string) {
  const group = durationGroup(scope, label)
  const toRaw = group.getByRole("button", { name: "Edit ISO 8601" })
  if (await toRaw.isVisible()) await toRaw.click()
  const input = group.getByRole("textbox")
  await input.fill(value)
  return input
}

/** Reads a DetailList value by its label (dt → dd). */
export function detailValue(scope: Page | Locator, label: string) {
  return scope
    .locator("dl > div")
    .filter({ has: pageOf(scope).locator("dt").filter({ hasText: exactly(label) }) })
    .locator("dd")
}

// ---------------------------------------------------------------------------
// Bookable slots

/**
 * Playwright's fake clock replaces `Date` with a constructor that returns plain Dates, so
 * `class X extends Date` (TZDate from @date-fns/tz) loses its prototype and every time zone
 * conversion in the page silently falls back to the browser's zone (Europe/Stockholm): a New
 * York slot at 09:00 shows as 15:00. Real browsers don't have this problem. This wraps the
 * fake Date so subclasses work again; the fake time is unchanged. Call before `page.goto`.
 */
export async function fixDateSubclassing(page: Page) {
  await page.addInitScript(() => {
    const ClockDate = window.Date
    const Probe = class extends ClockDate {}
    if (new Probe(0) instanceof Probe) return
    const PatchedDate = function (this: unknown, ...args: unknown[]) {
      if (!new.target) return (ClockDate as unknown as (...a: unknown[]) => string)(...args)
      const date = Reflect.construct(ClockDate, args) as Date
      Object.setPrototypeOf(date, new.target.prototype)
      return date
    } as unknown as DateConstructor
    Object.setPrototypeOf(PatchedDate, ClockDate)
    ;(PatchedDate as unknown as { prototype: Date }).prototype = ClockDate.prototype
    window.Date = PatchedDate
  })
}

/** Opens the slots tab of a service. */
export async function gotoSlots(page: Page, api: HapioApi, name: ServiceName) {
  const service = await gotoService(page, api, name, "slots")
  await expect(page.getByText("Find bookable slots")).toBeVisible()
  return service
}

export function slotsForm(page: Page) {
  return card(page, "Find bookable slots")
}

/** Picks a location in the slots form's Location combobox. */
export async function pickSlotsLocation(page: Page, location: string) {
  await slotsForm(page).getByRole("combobox", { name: "Location" }).click()
  const popover = page.locator('[data-slot="popover-content"]').last()
  await popover.getByRole("option", { name: new RegExp(`^${location}`) }).click()
  await expect(popover).toBeHidden()
}

/** Clicks Find slots and waits for the bookable-slots request. */
export async function findSlots(page: Page) {
  const request = page.waitForRequest((r) => r.url().includes("/bookable-slots") && r.method() === "GET")
  await slotsForm(page).getByRole("button", { name: "Find slots" }).click()
  const req = await request
  return new URL(req.url()).searchParams
}

/** Searches slots of a service at a location with the default range (Next 7 days). */
export async function searchSlots(page: Page, api: HapioApi, name: ServiceName, location = "Stockholm Studio") {
  const service = await gotoSlots(page, api, name)
  await pickSlotsLocation(page, location)
  const params = await findSlots(page)
  return { service, params }
}

/** The results summary, e.g. "40 slots · times in Europe/Stockholm". */
export function slotsSummary(page: Page) {
  return page.getByText(/^(\d+ slots?|Showing \d+ of \d+ slots) · times in /)
}

/** A day section of slot results by its date, e.g. "Thursday 22 October 2026". */
export function slotDay(page: Page, date: string) {
  return page.getByRole("region", { name: date, exact: true })
}

/** A slot row in a day section whose times start with `times`, e.g. "09:00 – 09:45". */
export function slotRow(day: Locator, times: string | RegExp) {
  const text = typeof times === "string" ? new RegExp(`^${times.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) : times
  return day.getByRole("listitem").filter({ has: pageOf(day).locator("p").filter({ hasText: text }) })
}

/** Resource badge names in a slot row. */
export function slotBadges(row: Locator) {
  return row.locator('[data-slot="badge"]')
}

/**
 * Like `ui.rowAction`, but opens the menu with the keyboard. A pointer click on a Radix
 * dropdown trigger within ~200 ms of a previous interaction (closing a menu, a toast)
 * is sometimes swallowed, which makes `ui.rowAction` flaky right after another action.
 */
export async function rowAction(row: Locator, item: string) {
  const page = row.page()
  const trigger = row.getByRole("button", { name: /^Actions/ })
  await trigger.press("Enter")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  await page.getByRole("menuitem", { name: exactly(item) }).click()
}
