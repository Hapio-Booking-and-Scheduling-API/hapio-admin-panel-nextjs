import { expect, test } from "../fixtures/test"
import { ADMIN_HEADERS } from "./_helpers"

// A stack whose app has no HAPIO_API_TOKEN (worker-scoped, so it lives in its own file).
test.use({ stackOptions: { token: null } })

const NOT_CONFIGURED = "HAPIO_API_TOKEN is not set. Add it to .env.local and restart the server."

test.describe("proxy without a token", () => {
  test("API answers 500 HAPIO_NOT_CONFIGURED", async ({ request }) => {
    const res = await request.get("/api/hapio/project", { headers: ADMIN_HEADERS })
    expect(res.status()).toBe(500)
    expect(await res.json()).toEqual({ message: NOT_CONFIGURED, code: "HAPIO_NOT_CONFIGURED" })
  })

  test("every method and path gets the same answer", async ({ request }) => {
    for (const res of [
      await request.get("/api/hapio/locations?per_page=1", { headers: ADMIN_HEADERS }),
      await request.post("/api/hapio/resources", { headers: ADMIN_HEADERS, data: { name: "x" } }),
      await request.delete("/api/hapio/resources/00000000-0000-4000-8000-000000000000", { headers: ADMIN_HEADERS }),
    ]) {
      expect(res.status()).toBe(500)
      expect((await res.json()).code).toBe("HAPIO_NOT_CONFIGURED")
    }
  })

  test("the guards still run first", async ({ request }) => {
    const res = await request.get("/api/hapio/project", { headers: { Accept: "application/json" } })
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({ message: "Missing X-Hapio-Admin header." })
  })

  test("the panel shows the setup banner and asks for /project only once", async ({ page, net }) => {
    await page.goto("/")
    const banner = page.getByRole("alert").filter({ hasText: "Connect your Hapio project" })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText("HAPIO_API_TOKEN=…")
    await expect(banner).toContainText(".env.local")
    // Give a (wrong) retry every chance to fire: TanStack's longest default delay is far below this.
    await page.clock.fastForward(30_000)
    await expect(page.getByRole("link", { name: "Open Bookings" })).toBeVisible()
    expect(net.find("GET", "project")).toHaveLength(1)
  })

  test("lists show the configuration error without retrying it", async ({ page, net, ui }) => {
    await page.goto("/locations")
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (500)" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(NOT_CONFIGURED)
    await page.clock.fastForward(30_000)
    await expect(alert).toBeVisible()
    expect(net.find("GET", "locations")).toHaveLength(1)
  })

  test("the sidebar falls back to a generic subtitle and the project page explains the error", async ({ page, ui }) => {
    await page.goto("/project")
    await expect(ui.main().getByRole("alert").filter({ hasText: NOT_CONFIGURED }).first()).toBeVisible()
    await expect(page.locator('[data-slot="sidebar"]').getByText("Booking API")).toBeVisible()
  })
})
