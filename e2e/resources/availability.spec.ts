import type { Locator, Page } from "@playwright/test"

import { NOW_MIDDAY } from "../fixtures/constants"
import type { HapioApi } from "../fixtures/hapio-api"
import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { createResource, detailValue, fixDateSubclassing, gotoResource } from "./_helpers"

const { anna, ben } = SEED.resources
const { stockholm, newYork } = SEED.locations

// Zone conversions (TZDate) need Date subclassing, which the fake clock breaks.
test.beforeEach(async ({ page }) => fixDateSubclassing(page))

function urlParam(page: Page, key: string) {
  return new URL(page.url()).searchParams.get(key)
}

function card(page: Page, title: string) {
  return page
    .getByRole("main")
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]', { hasText: new RegExp(`^${title}$`) }) })
}

/** The Details card's row for a day, e.g. "Wed 21 Oct". */
function dayRow(page: Page, day: string) {
  return card(page, "Details").getByRole("listitem").filter({ hasText: day })
}

/** The chips of a day row: its open and fully booked times, or "No open time". */
function chips(row: Locator) {
  return row.locator("div > span")
}

function timeline(page: Page) {
  return page.getByRole("figure", { name: "Open and fully booked time this week" })
}

function weekLabel(page: Page, label: string) {
  return page.getByRole("main").getByText(label, { exact: true })
}

/** Opens Anna's availability and waits for this week's computed schedule. */
async function openAvailability(page: Page, api: HapioApi, name: string = anna.name, query: Record<string, string> = {}) {
  const resource = await gotoResource(page, api, name, { tab: "availability", ...query })
  await expect(page.getByRole("tab", { name: "Availability" })).toHaveAttribute("aria-selected", "true")
  return resource
}

const WEEKDAYS_THIS_WEEK = ["Mon 19 Oct", "Tue 20 Oct", "Wed 21 Oct", "Thu 22 Oct", "Fri 23 Oct"]

test.describe("availability tab", () => {
  test("defaults to the resource's location and this week", async ({ page, api, ui }) => {
    await openAvailability(page, api)
    await expect(ui.main().getByRole("combobox", { name: "Location" })).toHaveText(stockholm.name)
    await expect(weekLabel(page, "19 Oct – 25 Oct 2026")).toBeVisible()
    await expect(ui.main().getByRole("button", { name: "This week" })).toBeDisabled()
    await expect(card(page, "Week overview")).toContainText(
      `Open time at ${stockholm.name}, in ${stockholm.timeZone}. Fully booked time applies across all locations.`
    )
    expect(urlParam(page, "av_location")).toBeNull()
    expect(urlParam(page, "av_week")).toBeNull()

    // Erik Lund's haircut (Thu 09:00, 45 min + 15 min buffer) fully books Anna, so that hour isn't open.
    for (const day of ["Mon 19 Oct", "Tue 20 Oct", "Wed 21 Oct", "Fri 23 Oct"]) {
      await expect(chips(dayRow(page, day))).toHaveText(["09:00–17:00"])
    }
    await expect(chips(dayRow(page, "Thu 22 Oct"))).toHaveText(["10:00–17:00", "Fully booked 09:00–10:00"])
    for (const day of ["Sat 24 Oct", "Sun 25 Oct"]) {
      await expect(chips(dayRow(page, day))).toHaveText(["No open time"])
    }

    const details = card(page, "Details")
    await expect(detailValue(details, "Open")).toHaveText("39 h")
    await expect(detailValue(details, "Fully booked")).toHaveText("1 h")
    await expect(detailValue(details, "Days open")).toHaveText("5 of 7")

    // The week view draws the same spans, with dated labels.
    await expect(timeline(page).getByRole("img", { name: "Open · Mon 19 Oct 09:00–17:00" })).toBeVisible()
    await expect(timeline(page).getByRole("img", { name: "Open · Thu 22 Oct 10:00–17:00" })).toBeVisible()
    await expect(timeline(page).getByRole("img", { name: "Fully booked · Thu 22 Oct 09:00–10:00" })).toBeVisible()
    await expect(timeline(page).getByRole("img", { name: /^Open · / })).toHaveCount(5)
  })

  test("steps through the weeks, kept in av_week", async ({ page, api, ui }) => {
    await openAvailability(page, api)
    await expect(chips(dayRow(page, "Mon 19 Oct"))).toHaveText(["09:00–17:00"])
    const thisWeek = ui.main().getByRole("button", { name: "This week" })

    await ui.main().getByRole("button", { name: "Next week" }).click()
    await expect(weekLabel(page, "26 Oct – 1 Nov 2026")).toBeVisible()
    await expect.poll(() => urlParam(page, "av_week")).toBe("2026-10-26")
    await expect(thisWeek).toBeEnabled()
    // Anna's lunch is blocked on Wednesday 28 October (12:00–14:00).
    await expect(chips(dayRow(page, "Wed 28 Oct"))).toHaveText(["09:00–12:00", "14:00–17:00"])
    // Across the DST change (25 Oct) the hours stay 09:00–17:00 wall time.
    await expect(chips(dayRow(page, "Mon 26 Oct"))).toHaveText(["09:00–17:00"])
    await expect(timeline(page).getByRole("img", { name: "Open · Wed 28 Oct 09:00–12:00" })).toBeVisible()

    // The week survives a reload.
    await page.reload()
    await expect(weekLabel(page, "26 Oct – 1 Nov 2026")).toBeVisible()
    await expect(chips(dayRow(page, "Wed 28 Oct"))).toHaveText(["09:00–12:00", "14:00–17:00"])

    await thisWeek.click()
    await expect(weekLabel(page, "19 Oct – 25 Oct 2026")).toBeVisible()
    await expect.poll(() => urlParam(page, "av_week")).toBeNull()
    await expect(thisWeek).toBeDisabled()

    await ui.main().getByRole("button", { name: "Previous week" }).click()
    await expect(weekLabel(page, "12 Oct – 18 Oct 2026")).toBeVisible()
    await expect.poll(() => urlParam(page, "av_week")).toBe("2026-10-12")
    // Maja Holm's haircut on Wed 14 Oct, 10:00.
    await expect(chips(dayRow(page, "Wed 14 Oct"))).toHaveText(["09:00–10:00", "11:00–17:00", "Fully booked 10:00–11:00"])
  })

  test("an invalid av_week falls back to this week", async ({ page, api }) => {
    await openAvailability(page, api, anna.name, { av_week: "2026-02-30" })
    await expect(weekLabel(page, "19 Oct – 25 Oct 2026")).toBeVisible()
    await expect(chips(dayRow(page, "Mon 19 Oct"))).toHaveText(["09:00–17:00"])
  })

  test("a date inside a week opens that week", async ({ page, api }) => {
    await openAvailability(page, api, anna.name, { av_week: "2026-10-29" })
    await expect(weekLabel(page, "26 Oct – 1 Nov 2026")).toBeVisible()
    await expect(chips(dayRow(page, "Wed 28 Oct"))).toHaveText(["09:00–12:00", "14:00–17:00"])
  })

  test("including fully booked time shows the whole schedule", async ({ page, api, ui, net }) => {
    await openAvailability(page, api)
    await expect(chips(dayRow(page, "Thu 22 Oct"))).toHaveText(["10:00–17:00", "Fully booked 09:00–10:00"])
    const legend = card(page, "Week overview")
    await expect(legend.getByText("Open", { exact: true })).toBeVisible()

    const request = net.waitFor("GET", /^resources\/[^/]+\/schedule$/, (c) => c.query.fully_booked === "include")
    await ui.main().getByRole("switch", { name: "Include fully booked" }).click()
    await request
    await expect.poll(() => urlParam(page, "av_booked")).toBe("true")
    await expect(legend.getByText("Scheduled", { exact: true })).toBeVisible()
    await expect(legend.getByText("Open", { exact: true })).toHaveCount(0)
    await expect(chips(dayRow(page, "Thu 22 Oct"))).toHaveText(["09:00–17:00", "Fully booked 09:00–10:00"])
    await expect(detailValue(card(page, "Details"), "Scheduled")).toHaveText("40 h")

    await ui.main().getByRole("switch", { name: "Include fully booked" }).click()
    await expect.poll(() => urlParam(page, "av_booked")).toBeNull()
    await expect(chips(dayRow(page, "Thu 22 Oct"))).toHaveText(["10:00–17:00", "Fully booked 09:00–10:00"])
  })

  test("another location shows its open time in its own zone", async ({ page, api, ui }) => {
    const nyId = await api.idOf("locations", newYork.name)
    await openAvailability(page, api)
    await expect(chips(dayRow(page, "Mon 19 Oct"))).toHaveText(["09:00–17:00"])

    await ui.pick(ui.main().getByRole("combobox", { name: "Location" }), newYork.name)
    await expect.poll(() => urlParam(page, "av_location")).toBe(nyId)
    await expect(card(page, "Week overview")).toContainText(`Open time at ${newYork.name}, in ${newYork.timeZone}.`)
    await expect(weekLabel(page, "19 Oct – 25 Oct 2026")).toBeVisible()
    // Anna's New York schedule is 09:00–17:00 New York time; Erik Lund's Stockholm haircut
    // (09:00–10:00 Stockholm) fully books her 03:00–04:00 New York time.
    await expect(chips(dayRow(page, "Thu 22 Oct"))).toHaveText(["09:00–17:00", "Fully booked 03:00–04:00"])
    for (const day of WEEKDAYS_THIS_WEEK.filter((d) => d !== "Thu 22 Oct")) {
      await expect(chips(dayRow(page, day))).toHaveText(["09:00–17:00"])
    }
    await expect(timeline(page).getByRole("img", { name: "Open · Mon 19 Oct 09:00–17:00" })).toBeVisible()
    await expect(detailValue(card(page, "Details"), "Open")).toHaveText("40 h")

    // The location is kept in the URL.
    await page.reload()
    await expect(ui.main().getByRole("combobox", { name: "Location" })).toHaveText(newYork.name)
    await expect(chips(dayRow(page, "Thu 22 Oct"))).toHaveText(["09:00–17:00", "Fully booked 03:00–04:00"])
  })

  test("a disabled resource says so above its schedule", async ({ page, api }) => {
    await api.patch(`resources/${await api.idOf("resources", ben.name)}`, { enabled: false })
    await openAvailability(page, api, ben.name)
    const alert = page.getByRole("main").getByRole("alert").filter({ hasText: "This resource is disabled" })
    await expect(alert).toContainText("Its schedule is shown below, but it can't take new bookings until it's enabled.")
    await expect(chips(dayRow(page, "Mon 19 Oct"))).toHaveText(["09:00–17:00"])
  })

  test("an enabled resource shows no disabled notice", async ({ page, api }) => {
    await openAvailability(page, api)
    await expect(chips(dayRow(page, "Mon 19 Oct"))).toHaveText(["09:00–17:00"])
    await expect(page.getByRole("main").getByText("This resource is disabled")).toHaveCount(0)
  })

  test("a resource without schedules links to the schedule tabs", async ({ page, api, ui }) => {
    await createResource(api, { name: "Studio C" })
    await openAvailability(page, api, "Studio C")
    // No schedules to hint at a location: the first location is used.
    await expect(ui.main().getByRole("combobox", { name: "Location" })).toHaveText(stockholm.name)
    const empty = card(page, "Details").locator('[data-slot="empty"]')
    await expect(empty).toContainText("No open time this week")
    await expect(empty).toContainText(`Add a recurring schedule or schedule block at ${stockholm.name} to open up time for bookings.`)
    await expect(card(page, "Details").getByRole("listitem")).toHaveCount(0)

    await empty.getByRole("button", { name: "Recurring schedules" }).click()
    await expect(page.getByRole("tab", { name: "Recurring schedules" })).toHaveAttribute("aria-selected", "true")
    await expect.poll(() => urlParam(page, "tab")).toBe("recurring")
    await expect(ui.main().getByText("No recurring schedules", { exact: true })).toBeVisible()

    await ui.tab("Availability")
    await card(page, "Details").locator('[data-slot="empty"]').getByRole("button", { name: "Schedule blocks" }).click()
    await expect(page.getByRole("tab", { name: "Schedule blocks" })).toHaveAttribute("aria-selected", "true")
    await expect.poll(() => urlParam(page, "tab")).toBe("blocks")
    await expect(ui.main().getByText("No schedule blocks", { exact: true })).toBeVisible()
  })

  test("a failed schedule request shows the error, and Retry recovers", async ({ page, api, ui, net }) => {
    await net.fail(/^resources\/[^/]+\/schedule$/, {
      method: "GET",
      status: 403,
      body: { message: "This action is unauthorized." },
      times: 1,
    })
    await openAvailability(page, api)
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (403)" })
    await expect(alert).toContainText("This action is unauthorized.")
    await expect(card(page, "Details")).toHaveCount(0)

    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(chips(dayRow(page, "Mon 19 Oct"))).toHaveText(["09:00–17:00"])
    await expect(alert).toHaveCount(0)
  })

  test("Retry reloads every failed request at once", async ({ page, api, ui, net }) => {
    for (const path of [/^resources\/[^/]+\/schedule$/, /^resources\/[^/]+\/fully-booked$/]) {
      await net.fail(path, { method: "GET", status: 403, body: { message: "This action is unauthorized." }, times: 1 })
    }
    await openAvailability(page, api)
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (403)" })
    await expect(alert).toBeVisible()

    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(chips(dayRow(page, "Thu 22 Oct"))).toHaveText(["10:00–17:00", "Fully booked 09:00–10:00"])
    await expect(alert).toHaveCount(0)
  })
})

test.describe("availability now marker", () => {
  test.use({ now: NOW_MIDDAY })

  test("marks the current time on today's row", async ({ page, api }) => {
    await openAvailability(page, api)
    await expect(chips(dayRow(page, "Wed 21 Oct"))).toHaveText(["09:00–17:00"])
    const markers = timeline(page).getByTestId("now-marker")
    await expect(markers).toHaveCount(1)
    const wednesday = timeline(page).locator(":scope > div").filter({ hasText: "Wed 21 Oct" })
    await expect(wednesday.getByTestId("now-marker")).toHaveCount(1)
    // 12:30 is 52.1 % of the day (the clock keeps running, so allow a little drift).
    const left = await markers.evaluate((el) => parseFloat((el as HTMLElement).style.left))
    expect(left).toBeGreaterThanOrEqual(52.08)
    expect(left).toBeLessThan(52.3)

    // Only the current week has a marker.
    await page.getByRole("main").getByRole("button", { name: "Next week" }).click()
    await expect(weekLabel(page, "26 Oct – 1 Nov 2026")).toBeVisible()
    await expect(timeline(page).getByTestId("now-marker")).toHaveCount(0)
  })
})

test.describe("availability without locations", () => {
  test.use({ seed: "empty" })

  test("explains that resources are scheduled at locations", async ({ page, api, ui }) => {
    await createResource(api, { name: "Solo" })
    await openAvailability(page, api, "Solo")
    const empty = ui.main().locator('[data-slot="empty"]')
    await expect(empty).toContainText("No locations yet")
    await expect(empty).toContainText("Resources are scheduled at locations. Create a location first.")
    await expect(empty.getByRole("link", { name: "Go to locations" })).toHaveAttribute("href", "/locations")
    await expect(timeline(page)).toHaveCount(0)
  })
})
