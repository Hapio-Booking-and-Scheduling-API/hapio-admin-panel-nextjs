import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { overrideResponseHeaders, rateLimitBadge, tooltip } from "./_helpers"

// The mock reports X-RateLimit-Limit 1000000 in e2e stacks; the header badge shows
// "remaining/limit" from the latest response.

test.describe("rate-limit badge", () => {
  test("shows remaining/limit from the latest response", async ({ page, ui }) => {
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    const badge = rateLimitBadge(page)
    await expect(badge).toHaveText(/^\d+\/1000000$/)
    const remaining = Number((await badge.textContent())!.split("/")[0])
    expect(remaining).toBeGreaterThan(999_900)
    expect(remaining).toBeLessThan(1_000_000)
    await expect(badge).toHaveAttribute("data-variant", "outline")
  })

  test("counts down as more requests are made", async ({ page, ui }) => {
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    const badge = rateLimitBadge(page)
    await expect(badge).toHaveText(/^\d+\/1000000$/)
    const read = async () => Number((await badge.textContent())!.split("/")[0])
    const before = await read()
    await page.getByRole("link", { name: "Open Locations" }).click()
    await expect(ui.main().getByRole("table").getByText(SEED.locations.stockholm.name)).toBeVisible()
    await expect.poll(read).toBeLessThan(before)
  })

  test("has a tooltip", async ({ page, ui }) => {
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    await rateLimitBadge(page).hover()
    await expect(tooltip(page, "API requests remaining this minute")).toBeVisible()
  })

  test("is hidden until a response reports a limit", async ({ page, ui }) => {
    await overrideResponseHeaders(page, { "x-ratelimit-limit": null, "x-ratelimit-remaining": null })
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(rateLimitBadge(page)).toHaveCount(0)
  })

  test("turns destructive when less than 20% is left", async ({ page, ui }) => {
    await overrideResponseHeaders(page, { "x-ratelimit-limit": "100", "x-ratelimit-remaining": "10" })
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    const badge = rateLimitBadge(page)
    await expect(badge).toHaveText("10/100")
    await expect(badge).toHaveAttribute("data-variant", "destructive")
  })

  test("exactly 20% left is not yet low", async ({ page, ui }) => {
    await overrideResponseHeaders(page, { "x-ratelimit-limit": "100", "x-ratelimit-remaining": "20" })
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(rateLimitBadge(page)).toHaveText("20/100")
    await expect(rateLimitBadge(page)).toHaveAttribute("data-variant", "outline")
  })

  test("follows the latest response, including error responses", async ({ page, net, ui }) => {
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(rateLimitBadge(page)).toHaveText(/\/1000000$/)
    await net.fail("locations", {
      method: "GET",
      status: 403,
      body: { message: "" },
      headers: { "X-RateLimit-Limit": "60", "X-RateLimit-Remaining": "3" },
    })
    await page.getByRole("link", { name: "Open Locations" }).click()
    await expect(ui.main().getByText("Request failed (403)")).toBeVisible()
    await expect(rateLimitBadge(page)).toHaveText("3/60")
    await expect(rateLimitBadge(page)).toHaveAttribute("data-variant", "destructive")
  })

  test("the project page reports the same numbers", async ({ page, ui }) => {
    await overrideResponseHeaders(page, { "x-ratelimit-limit": "100", "x-ratelimit-remaining": "42" })
    await page.goto("/project")
    await expect(ui.main().getByText("42 of 100 requests left this minute")).toBeVisible()
    await expect(rateLimitBadge(page)).toHaveText("42/100")
  })
})
