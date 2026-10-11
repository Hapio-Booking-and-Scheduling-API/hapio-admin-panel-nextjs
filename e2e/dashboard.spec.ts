import type { Page } from "@playwright/test"

import { SEED } from "./fixtures/seed"
import { expect, test } from "./fixtures/test"
import { failWhere } from "./shell/_helpers"

const main = (page: Page) => page.getByRole("main")
const card = (page: Page, title: string) =>
  main(page).locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]', { hasText: title }) })
const statCard = (page: Page, title: string) =>
  main(page).locator('[data-slot="card"]').filter({ has: page.getByRole("link", { name: `Open ${title}`, exact: true }) })
const upcoming = (page: Page) => card(page, "Upcoming bookings")
const awaiting = (page: Page) => card(page, "Awaiting finalization")

async function openDashboard(page: Page) {
  await page.goto("/")
  await expect(main(page).getByText(`Project: ${SEED.project}`)).toBeVisible()
}

test.describe("dashboard", () => {
  test("header: title, project and New booking", async ({ page, ui }) => {
    await openDashboard(page)
    await expect(ui.heading("Dashboard")).toBeVisible()
    await main(page).getByRole("link", { name: "New booking" }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/bookings/new")
    await expect(ui.heading("New booking")).toBeVisible()
  })

  test("stat cards show the seed counts with hints", async ({ page }) => {
    await openDashboard(page)
    for (const [title, value, hint] of [
      ["Bookings", SEED.dashboard.upcoming7Days, "In the next 7 days"],
      ["Locations", SEED.dashboard.locations, "Enabled"],
      ["Resources", SEED.dashboard.resources, "Enabled"],
      ["Services", SEED.dashboard.services, "Enabled"],
    ] as const) {
      const stat = statCard(page, title)
      await expect(stat.locator('[data-slot="card-description"]')).toHaveText(title)
      await expect(stat.locator("p").first()).toHaveText(String(value))
      await expect(stat.getByText(hint, { exact: true })).toBeVisible()
    }
  })

  for (const [title, href, heading] of [
    ["Bookings", "/bookings", "Bookings"],
    ["Locations", "/locations", "Locations"],
    ["Resources", "/resources", "Resources"],
    ["Services", "/services", "Services"],
  ] as const) {
    test(`"Open ${title}" goes to ${href}`, async ({ page, ui }) => {
      await openDashboard(page)
      await main(page).getByRole("link", { name: `Open ${title}`, exact: true }).click()
      await expect(page).toHaveURL((url) => url.pathname === href && url.search === "")
      await expect(ui.heading(heading)).toBeVisible()
    })
  }

  test("Upcoming bookings lists the next 7 days in order, including temporary holds", async ({ page, api }) => {
    await openDashboard(page)
    const items = upcoming(page).getByRole("listitem")
    await expect(items).toHaveCount(5)
    const expected = [
      { customer: "Erik Lund", date: "Thu 22 Oct", time: "09:00–09:45", service: "Haircut", where: "Anna · Stockholm Studio", status: "Confirmed" },
      { customer: "Nora Falk", date: "Thu 22 Oct", time: "14:00–14:45", service: "Haircut", where: "Ben · Stockholm Studio", status: "Confirmed" },
      { customer: "Pixel & Co", date: "Fri 23 Oct", time: "09:30–11:30", service: "Studio rental", where: "Room A · Stockholm Studio", status: "Confirmed" },
      { customer: "Fotostudion AB", date: "Mon 26 Oct", time: "09:00–17:00", service: "Equipment rental", where: "Room A · Stockholm Studio", status: "Confirmed" },
      { customer: "Ida Strand", date: "Tue 27 Oct", time: "10:00–10:45", service: "Haircut", where: "Anna · Stockholm Studio", status: "Temporary" },
    ]
    for (const [i, row] of expected.entries()) {
      const item = items.nth(i)
      const link = item.getByRole("link")
      await expect(link).toHaveAttribute("href", `/bookings/${(await api.bookingFor(row.customer)).id}`)
      const paragraphs = link.locator("p")
      await expect(paragraphs).toHaveText([row.date, row.time, row.service, row.where])
      await expect(link.locator('[data-slot="badge"]')).toHaveText(row.status)
    }
    // The canceled booking (Sara Ek, yesterday) and later bookings are left out.
    await expect(upcoming(page).getByText("Canceled")).toHaveCount(0)
  })

  test("an upcoming booking opens its detail page", async ({ page, api, ui }) => {
    await openDashboard(page)
    const booking = await api.bookingFor("Pixel & Co")
    await upcoming(page).getByRole("link", { name: /Studio rental/ }).click()
    await expect(page).toHaveURL((url) => url.pathname === `/bookings/${booking.id}`)
    await expect(ui.heading("Studio rental")).toBeVisible()
  })

  test("Awaiting finalization lists temporary bookings from today on", async ({ page, api }) => {
    await openDashboard(page)
    const items = awaiting(page).getByRole("listitem")
    await expect(items).toHaveCount(SEED.dashboard.awaiting.length)
    for (const [i, customer] of SEED.dashboard.awaiting.entries()) {
      await expect(items.nth(i).getByRole("link")).toHaveAttribute("href", `/bookings/${(await api.bookingFor(customer)).id}`)
      await expect(items.nth(i).locator('[data-slot="badge"]')).toHaveText("Temporary")
    }
    await expect(items.nth(0).locator("p")).toHaveText(["Tue 27 Oct", "10:00–10:45", "Haircut", "Anna · Stockholm Studio"])
    await expect(items.nth(1).locator("p")).toHaveText(["Mon 2 Nov", "15:00–15:45", "Haircut", "Ben · Stockholm Studio"])
  })

  test("\"View all\" on Upcoming opens the bookings list", async ({ page, ui }) => {
    await openDashboard(page)
    await upcoming(page).getByRole("link", { name: "View all" }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/bookings" && url.search === "")
    await expect(ui.heading("Bookings")).toBeVisible()
  })

  test("\"View all\" on Awaiting finalization filters to temporary bookings", async ({ page, ui }) => {
    await openDashboard(page)
    await awaiting(page).getByRole("link", { name: "View all" }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/bookings" && url.searchParams.get("temporary") === "only")
    await expect(ui.heading("Bookings")).toBeVisible()
    await expect(page.getByRole("combobox", { name: "Filter temporary" })).toHaveText("Only temporary")
    await ui.expectRowCount(2)
  })

  test("disabling a location lowers its stat after a reload", async ({ page, api }) => {
    await openDashboard(page)
    await expect(statCard(page, "Locations").locator("p").first()).toHaveText("2")
    const ny = await api.idOf("locations", SEED.locations.newYork.name)
    await api.patch(`locations/${ny}`, { enabled: false })
    await page.reload()
    await expect(main(page).getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(statCard(page, "Locations").locator("p").first()).toHaveText("1")
  })

  test("a newly created booking in range counts after a reload", async ({ page, api }) => {
    const [anna, haircut, sthlm] = await Promise.all([
      api.idOf("resources", "Anna"),
      api.idOf("services", "Haircut"),
      api.idOf("locations", SEED.locations.stockholm.name),
    ])
    await api.post("bookings", {
      resource_id: anna,
      service_id: haircut,
      location_id: sthlm,
      starts_at: "2026-10-23T13:00:00+02:00",
      ends_at: "2026-10-23T13:45:00+02:00",
    })
    await openDashboard(page)
    await expect(statCard(page, "Bookings").locator("p").first()).toHaveText("6")
    await expect(upcoming(page).getByRole("listitem")).toHaveCount(6)
  })

  test("queries span 7 calendar days across the DST change", async ({ page, net }) => {
    const upcomingCall = net.waitFor("GET", "bookings", (c) => c.query.temporary === "include")
    const pendingCall = net.waitFor("GET", "bookings", (c) => c.query.temporary === "only")
    await openDashboard(page)
    expect((await upcomingCall).query).toEqual({
      from: "2026-10-21T00:00:00+02:00",
      to: "2026-10-28T00:00:00+01:00",
      temporary: "include",
      per_page: "8",
      sort: "starts_at.asc",
    })
    expect((await pendingCall).query).toEqual({
      from: "2026-10-21T00:00:00+02:00",
      temporary: "only",
      per_page: "8",
      sort: "starts_at.asc",
    })
    for (const collection of ["locations", "resources", "services"]) {
      expect(net.find("GET", collection).map((c) => c.query)).toContainEqual({ per_page: "1" })
    }
  })

  test("the request URL encodes the offset's +", async ({ page, net }) => {
    const call = net.waitFor("GET", "bookings", (c) => c.query.temporary === "include")
    await openDashboard(page)
    expect((await call).request.url()).toContain("from=2026-10-21T00%3A00%3A00%2B02%3A00")
  })

  test.describe("with no data", () => {
    test.use({ seed: "empty" })

    test("shows zeros and both empty states", async ({ page }) => {
      await openDashboard(page)
      for (const title of ["Bookings", "Locations", "Resources", "Services"]) {
        await expect(statCard(page, title).locator("p").first()).toHaveText("0")
      }
      await expect(upcoming(page).getByText("Nothing to show")).toBeVisible()
      await expect(upcoming(page).getByText("No bookings in the next 7 days.")).toBeVisible()
      await expect(awaiting(page).getByText("Nothing to show")).toBeVisible()
      await expect(awaiting(page).getByText("No temporary bookings. All caught up.")).toBeVisible()
    })
  })

  test("a failing card shows an ErrorAlert, and Retry recovers it", async ({ page, api }) => {
    await failWhere(page, (c) => c.method === "GET" && c.path === "bookings" && c.query.temporary === "only", {
      status: 404,
      body: { message: "Not found." },
      times: 1,
    })
    await openDashboard(page)
    const alert = awaiting(page).getByRole("alert")
    await expect(alert).toContainText("Request failed (404)")
    // The other card is unaffected.
    await expect(upcoming(page).getByRole("listitem")).toHaveCount(5)
    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(awaiting(page).getByRole("listitem")).toHaveCount(2)
    await expect(alert).toBeHidden()
    await expect(awaiting(page).getByRole("listitem").first().getByRole("link")).toHaveAttribute("href", `/bookings/${(await api.bookingFor("Ida Strand")).id}`)
  })

  test("a failing stat shows a dash", async ({ page }) => {
    await failWhere(page, (c) => c.method === "GET" && c.path === "resources", { status: 403, body: { message: "" } })
    await openDashboard(page)
    await expect(statCard(page, "Resources").locator("p").first()).toHaveText("—")
    await expect(statCard(page, "Services").locator("p").first()).toHaveText("3")
  })

  test("the description falls back while the project is unavailable", async ({ page, net, ui }) => {
    await net.fail("project", { status: 404, body: { message: "Not found." } })
    await page.goto("/")
    await expect(statCard(page, "Locations").locator("p").first()).toHaveText("2")
    await expect(ui.main().getByText("Overview of your Hapio project.")).toBeVisible()
  })
})
