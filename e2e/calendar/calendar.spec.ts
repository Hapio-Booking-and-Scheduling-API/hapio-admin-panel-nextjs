import type { Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { fixDateSubclassing } from "../resources/_helpers"
import { navLink } from "../shell/_helpers"

const { stockholm, newYork } = SEED.locations
const { anna } = SEED.resources

// Zone conversions (TZDate) need Date subclassing, which the fake clock breaks.
test.beforeEach(async ({ page }) => fixDateSubclassing(page))

const SCHEDULE = /^resources\/[^/]+\/schedule$/

const main = (page: Page) => page.getByRole("main")

function urlParam(page: Page, key: string) {
  return new URL(page.url()).searchParams.get(key)
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** A booking in the calendar (a link), by its time and title, e.g. ("09:00", "Haircut · Anna"). */
function booking(page: Page, time: string, title: string) {
  return main(page).getByRole("link", { name: new RegExp(`^${time}\\b.*${escapeRegExp(title)}$`) })
}

/** A booking in the list view (a link in the "Events" list), by its time and title. */
function listBooking(page: Page, time: string, title: string) {
  return main(page)
    .getByRole("list", { name: "Events" })
    .getByRole("link", { name: new RegExp(`^${time}\\b.*${escapeRegExp(title)}$`) })
}

/** Every booking the calendar shows. */
function bookings(page: Page) {
  return main(page).getByRole("link", { name: /(Haircut|Studio rental|Equipment rental)/ })
}

function legend(page: Page) {
  return main(page).getByRole("list", { name: "Legend" })
}

test.describe("calendar", () => {
  test("opens from the sidebar on this week at the first location", async ({ page, api, net }) => {
    await page.goto("/")
    await expect(main(page).getByText(`Project: ${SEED.project}`)).toBeVisible()
    const request = net.waitFor("GET", "bookings", (c) => c.query.location !== undefined)
    await navLink(page, "Calendar").click()
    await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible()

    // Mon 19 – Mon 26 Oct in Stockholm's time; the clocks go back on Sun 25 Oct.
    expect((await request).query).toMatchObject({
      location: await api.idOf("locations", stockholm.name),
      from: "2026-10-19T00:00:00+02:00",
      to: "2026-10-26T00:00:00+01:00",
      temporary: "include",
      // Canceled bookings are hidden on the page, so showing them costs no request.
      canceled: "include",
      sort: "starts_at.asc",
    })
    await expect(main(page).getByText(`Bookings at ${stockholm.name}, shown in ${stockholm.timeZone}.`)).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Location" })).toHaveText(stockholm.name)
    await expect(page.getByRole("radio", { name: "Week view" })).toBeChecked()

    await expect(booking(page, "09:00", "Haircut · Anna")).toBeVisible() // Erik Lund
    await expect(booking(page, "14:00", "Haircut · Ben")).toBeVisible() // Nora Falk
    await expect(booking(page, "09:30", "Studio rental · Room A")).toBeVisible() // Pixel & Co
    // Sara Ek's canceled haircut is hidden by default.
    await expect(booking(page, "15:00", "Haircut · Anna")).toHaveCount(0)
    await expect(bookings(page)).toHaveCount(3)
    expect(urlParam(page, "date")).toBeNull()
    expect(urlParam(page, "view")).toBeNull()
  })

  test("shows canceled bookings on request, struck through and named", async ({ page, net }) => {
    await page.goto("/calendar")
    await expect(booking(page, "09:00", "Haircut · Anna")).toBeVisible()
    const requests = net.find("GET", "bookings").length

    await page.getByRole("switch", { name: "Show canceled" }).click()
    const canceled = booking(page, "15:00", "Haircut · Anna")
    await expect(canceled).toHaveAccessibleName(/Canceled: Haircut · Anna$/)
    await expect(canceled).toHaveCSS("text-decoration-line", "line-through")
    await expect(legend(page).getByText("Canceled")).toBeVisible()
    expect(urlParam(page, "canceled")).toBe("true")
    expect(net.find("GET", "bookings")).toHaveLength(requests)
  })

  test("opens a booking by click or keyboard; modified clicks open a new tab", async ({ page, context, api }) => {
    const erik = await api.bookingFor("Erik Lund")
    await page.goto("/calendar")
    const event = booking(page, "09:00", "Haircut · Anna")
    await expect(event).toHaveAttribute("href", `/bookings/${erik.id}`)

    const [tab] = await Promise.all([context.waitForEvent("page"), event.click({ modifiers: ["ControlOrMeta"] })])
    await expect(tab).toHaveURL(new RegExp(`/bookings/${erik.id}$`))
    await tab.close()
    await expect(page).toHaveURL(/\/calendar$/)

    await event.click()
    await expect(page).toHaveURL(new RegExp(`/bookings/${erik.id}$`))
    await page.goBack()
    await booking(page, "09:00", "Haircut · Anna").focus()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(new RegExp(`/bookings/${erik.id}$`))
  })

  test("moves between weeks and views and keeps them in the URL", async ({ page }) => {
    await page.goto("/calendar")
    await expect(booking(page, "09:00", "Haircut · Anna")).toBeVisible()

    await main(page).getByRole("button", { name: "Next Week" }).click()
    // Ida Strand's temporary haircut on Tuesday, after the clocks went back.
    const ida = booking(page, "10:00", "Haircut · Anna")
    await expect(ida).toHaveAccessibleName(/Temporary: Haircut · Anna$/)
    await expect(ida).toHaveCSS("font-style", "italic")
    await expect(booking(page, "09:00", "Equipment rental · Room A")).toBeVisible()
    await expect.poll(() => urlParam(page, "date")).toBe("2026-10-26")

    await page.getByRole("radio", { name: "Month view" }).click()
    await expect(main(page).getByText("October 2026", { exact: true })).toBeVisible()
    await expect.poll(() => urlParam(page, "view")).toBe("month")

    // A reload restores the view from the URL.
    await page.reload()
    await expect(page.getByRole("radio", { name: "Month view" })).toBeChecked()
    await expect(main(page).getByText("October 2026", { exact: true })).toBeVisible()
  })

  test("follows a link to the calendar while it's open", async ({ page }) => {
    await page.goto("/calendar?view=month&date=2026-11-01")
    await expect(main(page).getByText("November 2026", { exact: true })).toBeVisible()

    await navLink(page, "Calendar").click()
    await expect(page.getByRole("radio", { name: "Week view" })).toBeChecked()
    await expect(booking(page, "09:00", "Haircut · Anna")).toBeVisible()
    await expect(main(page).getByText("November 2026", { exact: true })).toHaveCount(0)
    expect(urlParam(page, "view")).toBeNull()
    expect(urlParam(page, "date")).toBeNull()
  })

  for (const date of ["not-a-date", "2026-02-30"]) {
    test(`ignores a malformed date in the URL (${date})`, async ({ page }) => {
      await page.goto(`/calendar?date=${date}`)
      await expect(booking(page, "09:00", "Haircut · Anna")).toBeVisible()
      await expect.poll(() => urlParam(page, "date")).toBeNull()
    })
  }

  test("shows another location's bookings in its own time zone", async ({ page, ui, api, net }) => {
    const newYorkId = await api.idOf("locations", newYork.name)
    await page.goto("/calendar?date=2026-10-26")
    await expect(booking(page, "10:00", "Haircut · Anna")).toBeVisible() // Ida Strand, in Stockholm

    // Hold New York's bookings back, to see what shows while they load.
    await net.delay("bookings", 1_500, { method: "GET", times: 1 })
    const request = net.waitFor("GET", "bookings", (c) => c.query.location === newYorkId)
    await ui.pick(page.getByRole("combobox", { name: "Location" }), newYork.name)
    await expect(main(page).getByText(`Bookings at ${newYork.name}, shown in ${newYork.timeZone}.`)).toBeVisible()
    // Stockholm's bookings don't linger under New York's name.
    await expect(bookings(page)).toHaveCount(0)
    await expect(main(page).getByRole("status").filter({ hasText: "Loading…" })).toBeVisible()
    // New York's own week, in its own zone: US daylight saving time ends on Sun 1 Nov.
    expect((await request).query).toMatchObject({ from: "2026-10-26T00:00:00-04:00", to: "2026-11-02T00:00:00-05:00" })

    // Jamie Carter, Thu 29 Oct 10:00 New York time, is the only booking there that week.
    await expect(booking(page, "10:00", "Haircut · Anna")).toBeVisible()
    await expect(bookings(page)).toHaveCount(1)
    expect(net.find("GET", "bookings").filter((c) => c.query.location === newYorkId)).toHaveLength(1)
  })

  test("shows a resource's open time, loaded once per week", async ({ page, ui, api, net }) => {
    const annaId = await api.idOf("resources", anna.name)
    const stockholmId = await api.idOf("locations", stockholm.name)
    await page.goto("/calendar")
    await expect(booking(page, "14:00", "Haircut · Ben")).toBeVisible()

    await ui.pick(page.getByRole("combobox", { name: "Resource" }), anna.name)
    await expect(booking(page, "14:00", "Haircut · Ben")).toHaveCount(0)
    await expect(booking(page, "09:00", "Haircut · Anna")).toBeVisible()

    const schedule = net.waitFor("GET", `resources/${annaId}/schedule`)
    await page.getByRole("switch", { name: "Show open time" }).click()
    expect((await schedule).query).toMatchObject({
      location: stockholmId,
      from: "2026-10-19T00:00:00+02:00",
      to: "2026-10-26T00:00:00+01:00",
      fully_booked: "exclude",
    })
    const open = main(page).getByRole("img", { name: /^Open · / })
    // Erik Lund's haircut (Thu 09:00, 45 min + 15 min buffer) fully books Anna's first hour that day.
    await expect(open).toHaveCount(5)
    for (const name of ["Open · Mon 19 Oct 09:00–17:00", "Open · Thu 22 Oct 10:00–17:00", "Open · Fri 23 Oct 09:00–17:00"]) {
      await expect(main(page).getByRole("img", { name })).toBeVisible()
    }
    await expect(legend(page).getByText("Open")).toBeVisible()
    expect(urlParam(page, "resource")).toBe(annaId)
    expect(urlParam(page, "availability")).toBe("true")

    // The day view reuses the week's open time.
    const requests = net.find("GET", SCHEDULE).length
    await page.getByRole("radio", { name: "Day view" }).click()
    await expect(main(page).getByRole("img", { name: "Open · Wed 21 Oct 09:00–17:00" })).toBeVisible()
    await expect(open).toHaveCount(1)
    expect(net.find("GET", SCHEDULE)).toHaveLength(requests)
  })

  test("asks for a resource before loading open time in the plain calendar", async ({ page, net }) => {
    await page.goto("/calendar")
    await expect(booking(page, "09:00", "Haircut · Anna")).toBeVisible()
    await page.getByRole("switch", { name: "Show open time" }).click()
    await expect(main(page).getByText(/^Pick a resource to see its open time/)).toBeVisible()

    // Wait for a later request, so any open-time request would have been made by now.
    await main(page).getByRole("button", { name: "Next Week" }).click()
    await expect(booking(page, "10:00", "Haircut · Anna")).toBeVisible()
    expect(net.find("GET", SCHEDULE)).toEqual([])
    await expect(legend(page).getByText("Open")).toHaveCount(0)
  })

  test("says where open time shows, and doesn't load it for the list and month views", async ({ page, api, net }) => {
    const annaId = await api.idOf("resources", anna.name)
    await page.goto(`/calendar?view=list&availability=true&resource=${annaId}`)
    await expect(listBooking(page, "09:00", "Haircut · Anna")).toBeVisible()
    await expect(main(page).getByText("Open time shows in the week and day views.")).toBeVisible()

    await page.getByRole("radio", { name: "Month view" }).click()
    await expect(main(page).getByText("October 2026", { exact: true })).toBeVisible()
    await expect(main(page).getByText("Open time shows in the week and day views.")).toBeVisible()
    expect(net.find("GET", SCHEDULE)).toEqual([])
  })

  test("the list view says when it's loading and when a period is empty", async ({ page, net }) => {
    await net.delay("bookings", 1_000, { method: "GET", times: 1 })
    await page.goto("/calendar?view=list")
    await expect(main(page).getByText("Loading bookings…")).toBeVisible()
    await expect(listBooking(page, "09:00", "Haircut · Anna")).toBeVisible()
    await expect(listBooking(page, "09:30", "Studio rental · Room A")).toHaveAttribute("href", /^\/bookings\//)
    await expect(main(page).getByText("Loading bookings…")).toHaveCount(0)

    await page.goto("/calendar?view=list&date=2026-12-07")
    await expect(main(page).getByText("No bookings in this period")).toBeVisible()
  })

  test("a failed request shows the error, and Retry recovers", async ({ page, ui, net }) => {
    await net.fail("bookings", { method: "GET", status: 403, body: { message: "This action is unauthorized." }, times: 1 })
    await page.goto("/calendar")
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (403)" })
    await expect(alert).toContainText("This action is unauthorized.")

    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(booking(page, "09:00", "Haircut · Anna")).toBeVisible()
    await expect(alert).toHaveCount(0)
  })

  test("a failed location load is an error, not 'No locations yet'", async ({ page, ui, net }) => {
    await net.fail("locations", { method: "GET", status: 403, body: { message: "This action is unauthorized." }, times: 1 })
    await page.goto("/calendar")
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (403)" })
    await expect(alert).toBeVisible()
    await expect(main(page).getByText("No locations yet")).toHaveCount(0)

    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(booking(page, "09:00", "Haircut · Anna")).toBeVisible()
    await expect(alert).toHaveCount(0)
  })

  test("warns when a period has more bookings than the calendar loads", async ({ page, net }) => {
    // Make the first page claim to be 1 of 25: the calendar stops after 20 pages.
    await net.transform(
      "bookings",
      (json) => {
        const body = json as { meta: Record<string, unknown> }
        return { ...body, meta: { ...body.meta, last_page: 25, total: 2_500 } }
      },
      { method: "GET", times: 1 }
    )
    await page.goto("/calendar")
    const alert = main(page).getByRole("alert").filter({ hasText: "Not every booking is shown" })
    await expect(alert).toContainText("This period has 2,500 bookings and the calendar loads the first 4")
    await expect(booking(page, "09:00", "Haircut · Anna")).toBeVisible()
    expect(net.find("GET", "bookings")).toHaveLength(20)
  })
})
