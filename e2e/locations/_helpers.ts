import { expect, type Locator, type Page } from "@playwright/test"

import type { HapioApi, Json } from "../fixtures/hapio-api"
import { SEED } from "../fixtures/seed"
import { exactly, type Ui } from "../helpers/ui"

export const STOCKHOLM = SEED.locations.stockholm.name
export const NEW_YORK = SEED.locations.newYork.name

export interface LocationJson extends Json {
  id: string
  name: string
  time_zone: string
  resource_selection_strategy: string
  resource_selection_priority: string[]
  metadata: Json | null
  protected_metadata?: Json | null
  enabled: boolean
  created_at: string
  updated_at: string
}

export function locationsTable(page: Page) {
  return page.getByRole("main").getByRole("table").first()
}

/** The Name cell of every data row, in order. */
export function nameCells(page: Page) {
  return locationsTable(page).locator("tbody tr td:first-child")
}

export function sortButton(page: Page, header: "Name" | "Created") {
  return locationsTable(page).getByRole("columnheader").getByRole("button", { name: header, exact: true })
}

/** Creates `count` randomize locations named "<prefix> 01", "<prefix> 02", … in that order. */
export async function createLocations(api: HapioApi, count: number, prefix = "Location") {
  const created: LocationJson[] = []
  for (let i = 1; i <= count; i++) {
    created.push(
      await api.post<LocationJson>("locations", {
        name: `${prefix} ${String(i).padStart(2, "0")}`,
        time_zone: "Europe/Stockholm",
        resource_selection_strategy: "randomize",
      })
    )
  }
  return created
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** The panel's "d MMM yyyy, HH:mm" for a Hapio timestamp, in the timestamp's own wall time. */
export function wallTime(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!m) throw new Error(`Not a timestamp: ${iso}`)
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]}`
}

/** Like wallTime, with the "(UTC±hh:mm)" suffix the detail page adds. */
export function wallTimeWithOffset(iso: string) {
  const offset = /([+-]\d{2}:\d{2}|Z)$/.exec(iso)?.[1]
  const suffix = !offset || offset === "Z" || offset === "+00:00" ? "UTC" : `UTC${offset}`
  return `${wallTime(iso)} (${suffix})`
}

/** A form field (label, control, description, error) by its visible label. */
export function formField(scope: Locator, label: string) {
  return scope
    .locator('[data-slot="field"]')
    .filter({ has: scope.page().locator('[data-slot="field-label"]', { hasText: exactly(label) }) })
}

/** The value cell of a DetailList row. */
export function detailValue(page: Page, label: string) {
  return page
    .getByRole("main")
    .locator("dl > div")
    .filter({ has: page.locator("dt", { hasText: exactly(label) }) })
    .locator("dd")
}

/** A SectionCard on a detail page, by its title. */
export function sectionCard(page: Page, title: string) {
  return page
    .getByRole("main")
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: exactly(title) }) })
}

// ---------------------------------------------------------------------------
// Advanced filters

export function filtersButton(page: Page) {
  return page.getByRole("main").getByRole("button", { name: /^Filters/ })
}

/** Opens the advanced filters popover and returns it. */
export async function openFilters(page: Page) {
  await filtersButton(page).click()
  const popover = page.locator('[data-slot="popover-content"]').filter({ hasText: "Advanced filters" })
  await expect(popover).toBeVisible()
  return popover
}

export function condition(popover: Locator, n: number) {
  return popover.getByRole("group", { name: `Condition ${n}`, exact: true })
}

export interface ConditionInput {
  field?: string
  op?: string
  property?: string
  value?: string
}

/** Fills one condition row. Field first, because changing it clears the rest. */
export async function setCondition(ui: Ui, row: Locator, input: ConditionInput) {
  if (input.field) await ui.choose(row.getByRole("combobox", { name: "Field" }), input.field)
  if (input.op) await ui.choose(row.getByRole("combobox", { name: "Operator" }), input.op)
  if (input.property !== undefined) await row.getByRole("textbox", { name: "Property" }).fill(input.property)
  if (input.value !== undefined) await row.getByLabel("Value", { exact: true }).fill(input.value)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The × on an applied filter chip. The property may or may not be shown in brackets. */
export function chipRemove(page: Page, label: string, op: string, value: string, property?: string) {
  const prop = property ? ` \\[?${escapeRe(property)}\\]?` : ""
  return page
    .getByRole("main")
    .getByRole("button", { name: new RegExp(`^Remove filter: ${escapeRe(label)}${prop} ${escapeRe(op)} ${escapeRe(value)}$`) })
}

/** Every applied filter chip's remove button. */
export function allChipRemoves(page: Page) {
  return page.getByRole("main").getByRole("button", { name: /^Remove filter: / })
}

/** Filter keys (with brackets) of a list request, e.g. ["name[eq]", "metadata[floor][gte]"]. */
export function filterKeys(query: Record<string, string>) {
  return Object.keys(query).filter((k) => k.includes("["))
}

/** Reads a query parameter of the current page URL. */
export function urlParam(page: Page, name: string) {
  return new URL(page.url()).searchParams.get(name)
}

/**
 * Makes client-side navigation to `pathname` slow, like on a poor connection: its
 * prefetches fail and the navigation request is held back `ms`. Exposes races between
 * a mutation's refetches and the route change.
 */
export async function slowNavigationTo(page: Page, pathname: string, ms = 1_500) {
  await page.route(
    (url) => url.pathname === pathname,
    async (route) => {
      const headers = route.request().headers()
      if (headers["rsc"] !== "1") return route.fallback()
      if (headers["next-router-prefetch"] || headers["next-router-segment-prefetch"]) return route.abort()
      await new Promise((resolve) => setTimeout(resolve, ms))
      await route.fallback()
    }
  )
}
