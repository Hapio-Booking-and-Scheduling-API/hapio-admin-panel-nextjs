import { expect, test } from "../fixtures/test"
import { expectAccessible } from "../helpers/a11y"
import { bookingRow, expectHydrated, seedGroup, short } from "./_helpers"

// Axe checks (serious and critical WCAG 2.1 A/AA violations) for the booking-group pages.
// Color contrast is left out: the theme's muted and destructive colours fail it on every
// page (shell-wide, not specific to booking groups), which would hide everything else.
const OPTIONS = { disable: ["color-contrast"] }

test.describe("booking groups accessibility", () => {
  test("list", async ({ page, ui }) => {
    await page.goto("/booking-groups")
    await expect(ui.row("2 confirmed")).toBeVisible()
    await expectAccessible(page, OPTIONS)
  })

  test("detail", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await page.goto(`/booking-groups/${group.id}`)
    await expect(ui.heading(`Booking group ${short(group.id)}`)).toBeVisible()
    await expectAccessible(page, OPTIONS)
  })

  test("new group form with validation errors", async ({ page }) => {
    await page.goto("/booking-groups/new")
    await expectHydrated(page)
    await page.getByRole("button", { name: /^Override rules/ }).click()
    await page.getByRole("button", { name: "Create booking group" }).click()
    await expect(bookingRow(page, 1).getByText("Select a service")).toBeVisible()
    await expectAccessible(page, OPTIONS)
  })

  test("edit dialog", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await page.goto(`/booking-groups/${group.id}`)
    await expect(ui.heading(`Booking group ${short(group.id)}`)).toBeVisible()
    await ui.main().getByRole("button", { name: "Edit", exact: true }).click()
    const dialog = ui.dialog(`Edit booking group ${short(group.id)}`)
    await dialog.getByRole("button", { name: "Remove booking 2" }).click()
    await expect(dialog.getByText("1 booking will be deleted when you save")).toBeVisible()
    await expectAccessible(page, { ...OPTIONS, include: '[role="dialog"]' })
  })
})
