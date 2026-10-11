import type { Page } from "@playwright/test"

import { SEED } from "./fixtures/seed"
import { expect, test } from "./fixtures/test"
import { failWhere, formatUtcStamp } from "./shell/_helpers"

const main = (page: Page) => page.getByRole("main")
const projectCard = (page: Page) =>
  main(page).locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]', { hasText: SEED.project }) })
const detail = (page: Page, label: string) =>
  projectCard(page).locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) }).locator("dd")

const WEBHOOK_EVENTS = [
  "booking.created",
  "booking.updated",
  "booking.deleted",
  "booking.finalized",
  "booking.canceled",
  "booking.reminder",
  "booking_group.created",
  "booking_group.updated",
  "booking_group.deleted",
  "location.created",
  "location.updated",
  "location.deleted",
  "resource.created",
  "resource.updated",
  "resource.deleted",
  "service.created",
  "service.updated",
  "service.deleted",
  "resource_service.created",
  "resource_service.deleted",
  "schedule_block.created",
  "schedule_block.updated",
  "schedule_block.deleted",
  "recurring_schedule.created",
  "recurring_schedule.updated",
  "recurring_schedule.deleted",
  "recurring_schedule_block.created",
  "recurring_schedule_block.updated",
  "recurring_schedule_block.deleted",
]

test.describe("project page", () => {
  test("shows the project name, status and id", async ({ page, api, ui }) => {
    const project = await api.project()
    await page.goto("/project")
    await expect(projectCard(page)).toBeVisible()
    await expect(ui.heading("Project")).toBeVisible()
    await expect(main(page).getByText("The Hapio project your API token belongs to.")).toBeVisible()
    await expect(projectCard(page).getByText("Enabled", { exact: true })).toBeVisible()
    await expect(detail(page, "Project ID")).toHaveText(project.id)
  })

  test("Copy ID copies the project id", async ({ page, api }) => {
    const project = await api.project()
    await page.goto("/project")
    await expect(detail(page, "Project ID")).toHaveText(project.id)
    await detail(page, "Project ID").getByRole("button", { name: "Copy ID" }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(project.id)
  })

  test("shows created and updated times in UTC", async ({ page, api }) => {
    const project = await api.get<{ created_at: string; updated_at: string }>("project")
    await page.goto("/project")
    await expect(detail(page, "Created")).toHaveText(formatUtcStamp(project.created_at))
    await expect(detail(page, "Updated")).toHaveText(formatUtcStamp(project.updated_at))
    await expect(detail(page, "Created")).toHaveText(/\(UTC\)$/)
  })

  test("shows the rate limit from the latest response", async ({ page }) => {
    await page.goto("/project")
    await expect(detail(page, "Rate limit")).toHaveText(/^\d+ of 1000000 requests left this minute$/)
  })

  test("a disabled project shows a Disabled badge", async ({ page, net }) => {
    await net.transform("project", (json) => ({ ...(json as object), enabled: false }))
    await page.goto("/project")
    await expect(projectCard(page).getByText("Disabled", { exact: true })).toBeVisible()
  })

  test("\"Open Hapio portal\" opens hapio.app in a new tab", async ({ page }) => {
    await page.goto("/project")
    await expect(projectCard(page)).toBeVisible()
    const portal = main(page).getByRole("link", { name: "Open Hapio portal" })
    await expect(portal).toHaveAttribute("href", "https://hapio.app")
    await expect(portal).toHaveAttribute("target", "_blank")
    await expect(portal).toHaveAttribute("rel", /noreferrer/)
  })

  test("lists the 29 webhook events", async ({ page }) => {
    await page.goto("/project")
    await expect(projectCard(page)).toBeVisible()
    const webhooks = main(page).locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]', { hasText: "Webhooks" }) })
    await expect(webhooks.locator('[data-slot="badge"]')).toHaveText(WEBHOOK_EVENTS)
    await expect(webhooks).toContainText("X-Hapio-Signature")
  })

  test("explains API tokens and abilities", async ({ page }) => {
    await page.goto("/project")
    await expect(projectCard(page)).toBeVisible()
    const tokens = main(page).locator('[data-slot="card"]').filter({ has: page.locator('[data-slot="card-title"]', { hasText: "API tokens" }) })
    await expect(tokens).toContainText("A 403 error means the token is missing an ability.")
    await expect(tokens).toContainText("booking:create")
  })

  test("404: \"This token isn't tied to a project\" with Retry", async ({ page, api }) => {
    // Fail until told otherwise: observers that mount after the first failure refetch it.
    let failing = true
    await failWhere(page, (c) => failing && c.path === "project", { status: 404, body: { message: "Not found." } })
    await page.goto("/project")
    const alert = main(page).getByRole("alert").filter({ hasText: "This token isn't tied to a project" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("Not found.")
    // The static cards still render.
    await expect(main(page).getByText("API tokens")).toBeVisible()
    failing = false
    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(detail(page, "Project ID")).toHaveText((await api.project()).id)
    await expect(alert).toBeHidden()
  })

  test("other errors use the generic error title", async ({ page, net }) => {
    await net.fail("project", { status: 403, body: { message: "" } })
    await page.goto("/project")
    const alert = main(page).getByRole("alert").filter({ hasText: "Request failed (403)" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("Check its abilities in the Hapio portal.")
  })

  test("the project is fetched once and shared with the sidebar", async ({ page, net }) => {
    await page.goto("/project")
    await expect(projectCard(page)).toBeVisible()
    await expect(page.locator('[data-slot="sidebar"]').getByText(SEED.project)).toBeVisible()
    expect(net.find("GET", "project")).toHaveLength(1)
  })
})
