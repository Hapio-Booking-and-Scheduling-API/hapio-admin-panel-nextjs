import type { Page, Route } from "@playwright/test"

import { parseHapioRequest, type HapioCall } from "../helpers/network"

/** The desktop sidebar (or the mobile sheet when it's open). */
export function sidebar(page: Page) {
  return page.locator('[data-slot="sidebar"]')
}

/** A sidebar navigation link by its title. */
export function navLink(page: Page, title: string) {
  return sidebar(page).locator('[data-sidebar="menu-button"]').filter({ hasText: new RegExp(`^${title}$`) })
}

/** Visible tooltip content (Radix's role=tooltip copy is visually hidden). */
export function tooltip(page: Page, text: string | RegExp) {
  return page.locator('[data-slot="tooltip-content"]').filter({ hasText: text })
}

/** The breadcrumb trail in the header. */
export function breadcrumbs(page: Page) {
  return page.getByRole("navigation", { name: "breadcrumb" })
}

/**
 * The rate-limit badge in the header ("remaining/limit"). It is also the tooltip trigger,
 * so its data-slot is "tooltip-trigger"; data-variant still tells outline from destructive.
 */
export function rateLimitBadge(page: Page) {
  return page.locator("header").getByText(/^\d+\/\d+$/)
}

/**
 * Routes proxy calls matching a predicate on the whole call (method, path and query),
 * which `net.fail` can't express (it matches on the path only).
 */
export async function routeHapio(
  page: Page,
  predicate: (call: HapioCall) => boolean,
  handler: (route: Route, call: HapioCall) => Promise<void>,
  options: { times?: number } = {}
) {
  let remaining = options.times ?? Infinity
  await page.route("**/api/hapio/**", async (route) => {
    const call = parseHapioRequest(route.request())
    if (!call || remaining <= 0 || !predicate(call)) return route.fallback()
    remaining--
    await handler(route, call)
  })
}

/** Answers proxy calls matching the predicate with a crafted JSON response. */
export function failWhere(
  page: Page,
  predicate: (call: HapioCall) => boolean,
  response: { status: number; body?: unknown; headers?: Record<string, string>; times?: number }
) {
  return routeHapio(
    page,
    predicate,
    (route) =>
      route.fulfill({
        status: response.status,
        contentType: "application/json",
        headers: response.headers,
        body: response.body === undefined ? "" : JSON.stringify(response.body),
      }),
    { times: response.times }
  )
}

/**
 * Passes every proxy call through and overrides response headers (e.g. X-RateLimit-*).
 * Header names must be lower case; `null` removes a header.
 */
export function overrideResponseHeaders(page: Page, overrides: Record<string, string | null>) {
  return routeHapio(
    page,
    () => true,
    async (route) => {
      const response = await route.fetch()
      const headers = { ...response.headers() }
      for (const [name, value] of Object.entries(overrides)) {
        if (value === null) delete headers[name]
        else headers[name] = value
      }
      await route.fulfill({ response, headers })
    }
  )
}

/** Wall-clock text the panel shows for an API timestamp with `withOffset`, e.g. "30 Sep 2026, 06:01 (UTC)". */
export function formatUtcStamp(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!m) throw new Error(`not a timestamp: ${iso}`)
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]} (UTC)`
}

