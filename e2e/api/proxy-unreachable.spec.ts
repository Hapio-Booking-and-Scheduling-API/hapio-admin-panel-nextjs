import { expect, test } from "../fixtures/test"
import { ADMIN_HEADERS } from "./_helpers"

// A stack whose upstream refuses connections (port 9, "discard", is closed on test machines).
test.use({ stackOptions: { baseUrl: "http://127.0.0.1:9/v1" } })

const UNREACHABLE = "Could not reach the Hapio API."

test.describe("proxy with an unreachable upstream", () => {
  test("API answers 502", async ({ request }) => {
    const res = await request.get("/api/hapio/project", { headers: ADMIN_HEADERS })
    expect(res.status()).toBe(502)
    expect(await res.json()).toEqual({ message: UNREACHABLE })
    expect(res.headers()["x-ratelimit-limit"]).toBeUndefined()
  })

  test("mutations answer 502 too", async ({ request }) => {
    const res = await request.post("/api/hapio/resources", { headers: ADMIN_HEADERS, data: { name: "x" } })
    expect(res.status()).toBe(502)
    expect(await res.json()).toEqual({ message: UNREACHABLE })
  })

  test("the panel shows the \"Can't reach Hapio\" banner", async ({ page }) => {
    await page.goto("/")
    const banner = page.getByRole("alert").filter({ hasText: "Can't reach Hapio" })
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(UNREACHABLE)
  })

  test("lists retry a 502 once, then show the error", async ({ page, net, ui }) => {
    await page.goto("/resources")
    await expect.poll(() => net.find("GET", "resources").length).toBe(1)
    await page.clock.fastForward(1_000)
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (502)" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(UNREACHABLE)
    expect(net.find("GET", "resources")).toHaveLength(2)
  })
})
