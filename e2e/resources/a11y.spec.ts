import type { Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { expectAccessible } from "../helpers/a11y"
import { createResource, fixDateSubclassing, gotoResource } from "./_helpers"

const { anna, ben, roomA } = SEED.resources

// Zone conversions (TZDate) need Date subclassing, which the fake clock breaks.
test.beforeEach(async ({ page }) => fixDateSubclassing(page))

/** Waits for animations and transitions (dialogs, enabled controls), so axe doesn't measure colours mid-fade. */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))
    )
  )
}

// The tab list and the header are covered by the shell's a11y sweeps, so these scan the tab
// panel or the dialog only.
test.describe("resource detail accessibility", () => {
  test("overview tab", async ({ page, api }) => {
    await gotoResource(page, api, anna.name)
    await expect(page.getByRole("tabpanel").getByText("One booking at a time.")).toBeVisible()
    await settle(page)
    await expectAccessible(page, { include: '[role="tabpanel"]' })
  })

  test("services tab", async ({ page, api }) => {
    await gotoResource(page, api, anna.name, { tab: "services" })
    const panel = page.getByRole("tabpanel")
    await expect(panel.getByRole("link", { name: SEED.services.haircut.name })).toBeVisible()
    await expect(panel.getByRole("combobox", { name: "Service to associate" })).toBeEnabled()
    await settle(page)
    await expectAccessible(page, { include: '[role="tabpanel"]' })
  })

  test("recurring schedules tab", async ({ page, api }) => {
    await gotoResource(page, api, anna.name, { tab: "recurring" })
    const panel = page.getByRole("tabpanel")
    await expect(panel.locator('[data-slot="collapsible-trigger"]')).toHaveCount(2)
    await panel.locator('[data-slot="collapsible-trigger"]').first().click()
    await expect(panel.getByRole("figure", { name: "Weekly hours" })).toBeVisible()
    await settle(page)
    await expectAccessible(page, { include: '[role="tabpanel"]' })
  })

  test("JSON tab", async ({ page, api }) => {
    await gotoResource(page, api, anna.name, { tab: "json" })
    await expect(page.getByRole("tabpanel").locator("pre")).toContainText(`"name": "${anna.name}"`)
    await settle(page)
    await expectAccessible(page, { include: '[role="tabpanel"]' })
  })

  test("availability without fully booked time", async ({ page, api }) => {
    // Room A takes two bookings at once, so this week has no fully booked time.
    await gotoResource(page, api, roomA.name, { tab: "availability" })
    await expect(page.getByRole("tabpanel").getByText("5 of 7")).toBeVisible()
    await settle(page)
    await expectAccessible(page, { include: '[role="tabpanel"]' })
  })

  test("availability with fully booked time", async ({ page, api }) => {
    await gotoResource(page, api, anna.name, { tab: "availability" })
    await expect(page.getByRole("tabpanel").getByText("Fully booked 09:00–10:00")).toBeVisible()
    await settle(page)
    await expectAccessible(page, { include: '[role="tabpanel"]' })
  })

  test("schedule blocks with only available time", async ({ page, api }) => {
    const resource = await createResource(api, { name: "Studio C" })
    await api.post(`resources/${resource.id}/schedule-blocks`, {
      location_id: await api.idOf("locations", SEED.locations.stockholm.name),
      starts_at: "2026-11-02T09:00:00+01:00",
      ends_at: "2026-11-02T12:00:00+01:00",
      is_available: true,
    })
    await gotoResource(page, api, "Studio C", { tab: "blocks" })
    await expect(page.getByRole("tabpanel").getByRole("cell", { name: "Available" })).toBeVisible()
    await settle(page)
    await expectAccessible(page, { include: '[role="tabpanel"]' })
  })

  test("schedule blocks with blocked time", async ({ page, api }) => {
    await gotoResource(page, api, anna.name, { tab: "blocks" })
    await expect(page.getByRole("tabpanel").getByRole("cell", { name: "Blocked" })).toBeVisible()
    await settle(page)
    await expectAccessible(page, { include: '[role="tabpanel"]' })
  })
})

test.describe("resource dialogs accessibility", () => {
  const dialogs = [
    { tab: "overview", button: "Edit", title: "Edit resource", resource: ben.name },
    { tab: "blocks", button: "New block", title: "New schedule block", resource: anna.name },
    { tab: "recurring", button: "New schedule", title: "New recurring schedule", resource: ben.name },
    { tab: "recurring", button: "Add weekday hours", title: "Add weekday hours", resource: ben.name },
    { tab: "recurring", button: "Add block", title: "Add block", resource: ben.name },
  ]
  for (const { tab, button, title, resource } of dialogs) {
    test(`${title} dialog`, async ({ page, api }) => {
      await gotoResource(page, api, resource, { tab })
      await page.getByRole("main").getByRole("button", { name: button, exact: true }).first().click()
      await expect(page.getByRole("dialog", { name: title })).toBeVisible()
      await settle(page)
      await expectAccessible(page, { include: '[role="dialog"]' })
    })
  }
})
