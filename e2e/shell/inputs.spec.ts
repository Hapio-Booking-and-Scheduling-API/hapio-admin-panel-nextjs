import type { Locator, Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import type { Ui } from "../helpers/ui"

// Shared inputs (src/components/inputs) through the forms that use them.

async function openNewLocation(page: Page, ui: Ui) {
  await page.goto("/locations")
  await expect(ui.row(SEED.locations.stockholm.name)).toBeVisible()
  await ui.main().getByRole("button", { name: "New location" }).click()
  const dialog = ui.dialog("New location")
  await expect(dialog).toBeVisible()
  return dialog
}

const timeZone = (dialog: Locator) => dialog.getByRole("combobox", { name: "Time zone" })

test.describe("time zone picker", () => {
  test("offers the current IANA names, not ICU's legacy aliases", async ({ page, ui, net }) => {
    const dialog = await openNewLocation(page, ui)
    await timeZone(dialog).click()
    const popover = page.locator('[data-slot="popover-content"]').last()
    const search = popover.locator('[data-slot="command-input"]')
    // The search is fuzzy, so look for the exact options.
    await search.fill("kyiv")
    await expect(popover.getByRole("option", { name: "Europe/Kyiv", exact: true })).toBeVisible()
    await search.fill("kiev")
    await expect(popover.getByRole("option").first()).toBeVisible()
    await expect(popover.getByRole("option", { name: "Europe/Kiev", exact: true })).toHaveCount(0)
    await search.fill("calcutta")
    await expect(popover.getByRole("option").first()).toBeVisible()
    await expect(popover.getByRole("option", { name: "Asia/Calcutta", exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(popover).toBeHidden()

    await ui.pick(timeZone(dialog), "Asia/Kolkata", { search: "kolkata" })
    await expect(timeZone(dialog)).toHaveText("Asia/Kolkata")
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Mumbai")
    const request = net.waitFor("POST", "locations")
    await dialog.getByRole("button", { name: "Create location" }).click()
    expect((await request).body).toMatchObject({ name: "Mumbai", time_zone: "Asia/Kolkata" })
  })

  test("shows a saved zone in full, also one the browser doesn't list", async ({ page, api, ui }) => {
    await api.post("locations", { name: "Gulf office", time_zone: "Etc/GMT-3", resource_selection_strategy: "randomize" })
    await page.goto("/locations")
    await ui.rowAction(ui.row("Gulf office"), "Edit")
    const dialog = ui.dialog("Edit location")
    await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Gulf office")
    await expect(timeZone(dialog)).toHaveText("Etc/GMT-3")
    // Still selectable from the list, next to the runtime's zones.
    await ui.pick(timeZone(dialog), "Etc/GMT-3", { search: "GMT-3" })
    await expect(timeZone(dialog)).toHaveText("Etc/GMT-3")
  })

  test.describe("in India", () => {
    // Chrome reports this zone under ICU's legacy id, Asia/Calcutta.
    test.use({ timezoneId: "Asia/Kolkata" })

    test("a new location defaults to the browser's zone under its current name", async ({ page, ui }) => {
      const dialog = await openNewLocation(page, ui)
      await expect(timeZone(dialog)).toHaveText("Asia/Kolkata")
    })
  })
})

test.describe("duration input", () => {
  test("the ISO 8601 editor drops whitespace, so a pasted ' PT1H30M ' is valid", async ({ page, ui }) => {
    await page.goto("/services")
    await expect(ui.main().getByRole("table").getByText(SEED.services.haircut.name)).toBeVisible()
    await ui.main().getByRole("button", { name: "New service" }).click()
    const dialog = ui.dialog("New service")
    const duration = dialog.getByRole("group", { name: "Duration", exact: true }).first()
    await duration.getByRole("button", { name: "Edit ISO 8601" }).click()
    const raw = duration.getByRole("textbox")
    await raw.fill(" pt1h30m \n")
    await expect(raw).toHaveValue("PT1H30M")
    await expect(raw).not.toHaveAttribute("aria-invalid", "true")
    await expect(duration.getByText("PT1H30M · 1 h 30 min")).toBeVisible()
  })
})
