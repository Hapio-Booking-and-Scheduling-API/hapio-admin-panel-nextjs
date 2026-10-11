import { expect, type Locator, type Page } from "@playwright/test"

import type { HapioApi, Json } from "../fixtures/hapio-api"
import { exactly } from "../helpers/ui"

export interface Named {
  id: string
  name: string
}

export interface ScheduleBlockJson {
  id: string
  location: Named & { time_zone: string }
  starts_at: string
  ends_at: string
  is_available: boolean
}

export interface RecurringScheduleJson {
  id: string
  location: Named & { time_zone: string }
  start_date: string
  end_date: string | null
  interval: number
}

export interface RecurringBlockJson {
  id: string
  weekday: string
  start_time: string
  end_time: string
}

/** Opens a resource's detail page (optionally on a tab) and waits for its heading, which comes from the API. */
export async function gotoResource(page: Page, api: HapioApi, name: string, query: Record<string, string> = {}) {
  const resource = await api.byName("resources", name)
  const qs = new URLSearchParams(query).toString()
  await page.goto(`/resources/${resource.id}${qs ? `?${qs}` : ""}`)
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible()
  return resource
}

/** Creates a resource straight in the mock. */
export function createResource(api: HapioApi, body: Json & { name: string }) {
  return api.post<Named & Json>("resources", body)
}

export async function scheduleBlocksOf(api: HapioApi, resourceId: string) {
  return api.list<ScheduleBlockJson>(`resources/${resourceId}/schedule-blocks`)
}

export async function recurringSchedulesOf(api: HapioApi, resourceId: string) {
  return api.list<RecurringScheduleJson>(`resources/${resourceId}/recurring-schedules`)
}

export async function recurringBlocksOf(api: HapioApi, resourceId: string, scheduleId: string) {
  return api.list<RecurringBlockJson>(`resources/${resourceId}/recurring-schedules/${scheduleId}/schedule-blocks`)
}

/** The one recurring schedule of a resource at a location (seed: Mon–Fri 09–17). */
export async function scheduleAt(api: HapioApi, resourceId: string, locationName: string) {
  const match = (await recurringSchedulesOf(api, resourceId)).find((s) => s.location.name === locationName)
  if (!match) throw new Error(`No recurring schedule at ${locationName}`)
  return match
}

/**
 * The form field (shadcn Field) whose label reads exactly `label`. FormField's wrapper
 * has no accessible name, so this scopes by its label's text.
 */
export function formField(scope: Locator, label: string) {
  return scope
    .locator('[data-slot="field"]')
    .filter({ has: scope.page().locator('[data-slot="field-label"]', { hasText: exactly(label) }) })
    .last()
}

/** The validation message under a form field. */
export function fieldError(scope: Locator, label: string) {
  return formField(scope, label).locator('[data-slot="field-error"]')
}

/** A value in a DetailList (overview cards), by its label. */
export function detailValue(scope: Locator, label: string) {
  return scope
    .locator("dl > div")
    .filter({ has: scope.page().locator("dt", { hasText: exactly(label) }) })
    .locator("dd")
}

/** Makes every cached query stale and fires the browser's reconnect event, so TanStack Query refetches. */
export async function refetchOnReconnect(page: Page) {
  await page.clock.fastForward(31_000)
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"))
    window.dispatchEvent(new Event("online"))
  })
}

/** "2026-09-30T06:01:00+00:00" → "30 Sep 2026, 06:01" (the panel's formatDateTime of the timestamp's wall time). */
export function wallDateTime(iso: string) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const [, y, mo, d, hh, mm] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)!
  return `${Number(d)} ${months[Number(mo) - 1]} ${y}, ${hh}:${mm}`
}

/**
 * Playwright's fake clock replaces `Date` with a constructor that returns plain Dates, so
 * `class X extends Date` (TZDate from @date-fns/tz) loses its prototype and every time zone
 * conversion in the page silently falls back to the browser's zone. This wraps the fake
 * Date so subclasses work again; the fake time is unchanged. Call before `page.goto`.
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
