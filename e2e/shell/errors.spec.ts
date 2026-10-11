import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { expectToast } from "../helpers/toasts"
import { failWhere } from "./_helpers"

// Alerts rendered by the panel (Next's route announcer also has role="alert").
const alerts = (page: import("@playwright/test").Page) => page.locator('[data-slot="alert"]')
const banner = (page: import("@playwright/test").Page, title: string) => alerts(page).filter({ hasText: title })

test.describe("setup banner", () => {
  test("401 on /project: \"Hapio rejected the API token\"", async ({ page, net, ui }) => {
    await net.fail("project", { status: 401, body: { message: "Unauthenticated." } })
    await page.goto("/")
    const alert = banner(page, "Hapio rejected the API token")
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("Check HAPIO_API_TOKEN in .env.local.")
    // "Unauthenticated." is replaced by a helpful hint.
    await expect(alert).toContainText("The Hapio API token is missing or invalid.")
    // The rest of the dashboard still loads.
    await expect(ui.main().getByRole("link", { name: "Open Locations" })).toBeVisible()
    await expect(ui.main().getByText("Overview of your Hapio project.")).toBeVisible()
  })

  test("network failure: \"Can't reach Hapio\"", async ({ page, net, consoleGuard }) => {
    consoleGuard.allow(/net::ERR_FAILED/)
    await net.abort("project")
    await page.goto("/locations")
    const alert = banner(page, "Can't reach Hapio")
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("Network error: could not reach the admin server.")
    await expect(page.getByRole("main").getByRole("table").getByText(SEED.locations.stockholm.name)).toBeVisible()
  })

  test("502 from the proxy: \"Can't reach Hapio\"", async ({ page, net }) => {
    await net.fail("project", { status: 502, body: { message: "Could not reach the Hapio API." } })
    await page.goto("/")
    const alert = banner(page, "Can't reach Hapio")
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("Could not reach the Hapio API.")
  })

  test("404 on /project: no banner, but the project page explains it", async ({ page, net, ui }) => {
    await net.fail("project", { status: 404, body: { message: "Not found." } })
    await page.goto("/project")
    await expect(ui.main().getByRole("alert").filter({ hasText: "This token isn't tied to a project" })).toBeVisible()
    await expect(alerts(page)).toHaveCount(1)
    for (const title of ["Connect your Hapio project", "Hapio rejected the API token", "Can't reach Hapio"]) {
      await expect(banner(page, title)).toHaveCount(0)
    }
  })

  test("a healthy project shows no banner", async ({ page, ui }) => {
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(alerts(page)).toHaveCount(0)
  })
})

test.describe("query errors", () => {
  test("403 on a list shows an ErrorAlert with the abilities hint", async ({ page, net, ui }) => {
    await net.fail("locations", { method: "GET", status: 403, body: { message: "" } })
    await page.goto("/locations")
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (403)" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("The API token isn't allowed to do this. Check its abilities in the Hapio portal.")
    // 4xx errors aren't retried.
    expect(net.find("GET", "locations")).toHaveLength(1)
  })

  test("403 with Hapio's own message still points at the token's abilities", async ({ page, net, ui }) => {
    await net.fail("resources", { method: "GET", status: 403, body: { message: "This action is unauthorized." } })
    await page.goto("/resources")
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (403)" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("This action is unauthorized.")
    await expect(alert).toContainText("Check its abilities in the Hapio portal.")
  })

  test("500 is retried once, then shown, and Retry recovers", async ({ page, net, ui }) => {
    await net.fail("services", { method: "GET", status: 500, body: { message: "" }, times: 2 })
    await page.goto("/services")
    await expect.poll(() => net.find("GET", "services").length).toBe(1)
    // The retry waits 1 s.
    await page.clock.fastForward(1_000)
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (500)" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("Hapio had an internal error.")
    expect(net.find("GET", "services")).toHaveLength(2)

    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(ui.main().getByRole("table").getByText(SEED.services.haircut.name)).toBeVisible()
    await expect(alert).toBeHidden()
    expect(net.find("GET", "services")).toHaveLength(3)
  })

  test("500 with Hapio's message shows that message", async ({ page, net, ui }) => {
    await net.fail("resources", { method: "GET", status: 500, body: { message: "Server Error" } })
    await page.goto("/resources")
    await expect.poll(() => net.find("GET", "resources").length).toBe(1)
    await page.clock.fastForward(1_000)
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (500)" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("Server Error")
  })

  test("429 with Retry-After: 2 is retried up to 3 times, then succeeds", async ({ page, net, ui }) => {
    await net.fail("locations", {
      method: "GET",
      status: 429,
      body: { message: "Too Many Attempts." },
      headers: { "Retry-After": "2" },
      times: 3,
    })
    await page.goto("/locations")
    for (let attempt = 1; attempt <= 3; attempt++) {
      await expect.poll(() => net.find("GET", "locations").length).toBe(attempt)
      await page.clock.fastForward(2_000)
    }
    await expect(ui.main().getByRole("table").getByText(SEED.locations.newYork.name)).toBeVisible()
    expect(net.find("GET", "locations")).toHaveLength(4)
    await expect(alerts(page)).toHaveCount(0)
  })

  test("429 waits for Retry-After before retrying", async ({ page, net, ui }) => {
    await net.fail("resources", {
      method: "GET",
      status: 429,
      body: { message: "Too Many Attempts." },
      headers: { "Retry-After": "30" },
      times: 1,
    })
    await page.goto("/resources")
    await expect.poll(() => net.find("GET", "resources").length).toBe(1)
    await page.clock.fastForward(25_000)
    // Round-trip to the page so a due retry would have been sent by now.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)))
    expect(net.find("GET", "resources")).toHaveLength(1)
    await page.clock.fastForward(5_000)
    await expect(ui.main().getByRole("table").getByText(SEED.resources.ben.name)).toBeVisible()
    expect(net.find("GET", "resources")).toHaveLength(2)
  })

  test("429 that never clears gives up after 4 attempts with the rate-limit message", async ({ page, net, ui }) => {
    await net.fail("services", { method: "GET", status: 429, body: { message: "" }, headers: { "Retry-After": "1" } })
    await page.goto("/services")
    for (let attempt = 1; attempt <= 3; attempt++) {
      await expect.poll(() => net.find("GET", "services").length).toBe(attempt)
      await page.clock.fastForward(1_000)
    }
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (429)" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("Rate limit reached. Retrying shortly.")
    expect(net.find("GET", "services")).toHaveLength(4)
  })

  test("only the failing card errors; the rest of the page works", async ({ page, ui }) => {
    await failWhere(page, (c) => c.method === "GET" && c.path === "bookings" && c.query.temporary === "only", {
      status: 400,
      body: { message: "Bad filter." },
    })
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(ui.main().getByRole("alert").filter({ hasText: "Bad filter." })).toHaveCount(1)
  })
})

test.describe("mutation errors", () => {
  test("a failed mutation shows an error toast and keeps the data", async ({ page, api, net, ui }) => {
    const location = await api.byName("locations", SEED.locations.newYork.name)
    await net.fail(`locations/${location.id}`, { method: "PATCH", status: 500, body: { message: "" } })
    await page.goto(`/locations/${location.id}`)
    await expect(ui.heading(SEED.locations.newYork.name)).toBeVisible()
    await ui.main().getByRole("button", { name: "Disable" }).click()
    await expectToast(page, "Hapio had an internal error.", { type: "error" })
    // Mutations aren't retried.
    expect(net.find("PATCH", `locations/${location.id}`)).toHaveLength(1)
    await expect(ui.main().getByRole("button", { name: "Disable" })).toBeEnabled()
    expect((await api.get(`locations/${location.id}`)).enabled).toBe(true)
  })

  test("a network failure during a mutation shows the network error", async ({ page, api, net, ui, consoleGuard }) => {
    consoleGuard.allow(/net::ERR_FAILED/)
    const resource = await api.byName("resources", SEED.resources.ben.name)
    await net.abort(`resources/${resource.id}`, { method: "PATCH" })
    await page.goto(`/resources/${resource.id}`)
    await expect(ui.heading(SEED.resources.ben.name)).toBeVisible()
    await ui.main().getByRole("button", { name: "Disable" }).click()
    await expectToast(page, "Network error: could not reach the admin server.", { type: "error" })
  })

  test("a failed delete keeps the confirm dialog open", async ({ page, api, net, ui }) => {
    const service = await api.byName("services", SEED.services.equipment.name)
    await net.fail(`services/${service.id}`, { method: "DELETE", status: 403, body: { message: "" } })
    await page.goto(`/services/${service.id}`)
    await expect(ui.heading(SEED.services.equipment.name)).toBeVisible()
    await ui.main().getByRole("button", { name: "Delete" }).click()
    const dialog = ui.alertDialog(`Delete ${SEED.services.equipment.name}?`)
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Delete service" }).click()
    const message = "The API token isn't allowed to do this. Check its abilities in the Hapio portal."
    // The modal dialog covers the toast's close button: close the toast after the dialog.
    await expectToast(page, message, { type: "error", close: false })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Delete service" })).toBeEnabled()
    await expect(page).toHaveURL(new RegExp(`/services/${service.id}$`))
    await ui.dismiss(`Delete ${SEED.services.equipment.name}?`)
    await expectToast(page, message)
    await api.get(`services/${service.id}`)
  })
})
