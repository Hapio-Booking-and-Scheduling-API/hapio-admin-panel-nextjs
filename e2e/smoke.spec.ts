import { SEED } from "./fixtures/seed"
import { expect, test } from "./fixtures/test"

// Loads every page against the demo data. Each first assertion is on API data, which
// proves the page hydrated and fetched through the proxy from this worker's mock.
test.describe("smoke", () => {
  test("dashboard", async ({ page, ui }) => {
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
  })

  for (const [path, text] of [
    ["/locations", SEED.locations.stockholm.name],
    ["/resources", SEED.resources.roomA.name],
    ["/services", SEED.services.studio.name],
    ["/bookings", "Studio rental"],
    ["/booking-groups", "2 confirmed"],
  ] as const) {
    test(`list ${path}`, async ({ page, ui }) => {
      await page.goto(path)
      await expect(ui.main().getByRole("table").first().getByText(text).first()).toBeVisible()
    })
  }

  test("detail pages", async ({ page, api, ui }) => {
    const location = await api.byName("locations", SEED.locations.stockholm.name)
    await page.goto(`/locations/${location.id}`)
    await expect(ui.heading(SEED.locations.stockholm.name)).toBeVisible()

    const resource = await api.byName("resources", SEED.resources.anna.name)
    await page.goto(`/resources/${resource.id}`)
    await expect(ui.heading(SEED.resources.anna.name)).toBeVisible()

    const service = await api.byName("services", SEED.services.haircut.name)
    await page.goto(`/services/${service.id}`)
    await expect(ui.heading(SEED.services.haircut.name)).toBeVisible()

    const booking = await api.bookingFor("Erik Lund")
    await page.goto(`/bookings/${booking.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()

    const [group] = await api.list<{ id: string }>("booking-groups")
    await page.goto(`/booking-groups/${group.id}`)
    await expect(ui.heading(/^Booking group/)).toBeVisible()
  })

  test("new pages and project", async ({ page, ui }) => {
    await page.goto("/bookings/new")
    await expect(ui.heading("New booking")).toBeVisible()
    await page.goto("/booking-groups/new")
    await expect(ui.heading("New booking group")).toBeVisible()
    await page.goto("/project")
    await expect(ui.main().getByText(SEED.project).first()).toBeVisible()
  })

  test("browser clock follows the fixed now", async ({ page }) => {
    await page.goto("/")
    expect(await page.evaluate(() => new Date().toISOString())).toMatch(/^2026-10-21T06:0/)
  })
})
