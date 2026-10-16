import type { Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import type { Ui } from "../helpers/ui"
import { expectAccessible } from "../helpers/a11y"
import { fixDateSubclassing } from "../resources/_helpers"

// axe (WCAG 2.1 A/AA, serious + critical) on every page and the main dialogs, after the
// page has rendered API data. Violations found here are bugs, not rules to disable.

const main = (page: Page) => page.getByRole("main")

test.describe("a11y: pages", () => {
  test("dashboard", async ({ page, ui }) => {
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(main(page).locator('[data-slot="card"] li')).toHaveCount(7)
    await expectAccessible(page)
  })

  for (const [path, text] of [
    ["/bookings", "Studio rental"],
    ["/booking-groups", "2 confirmed"],
    ["/locations", SEED.locations.newYork.name],
    ["/resources", SEED.resources.roomA.name],
    ["/services", SEED.services.equipment.name],
  ] as const) {
    test(`list ${path}`, async ({ page }) => {
      await page.goto(path)
      await expect(main(page).getByRole("table").getByText(text).first()).toBeVisible()
      await expectAccessible(page)
    })
  }

  test("project", async ({ page }) => {
    await page.goto("/project")
    await expect(main(page).getByText("Project ID")).toBeVisible()
    await expectAccessible(page)
  })

  test("location detail (overview and JSON)", async ({ page, api, ui }) => {
    await page.goto(`/locations/${await api.idOf("locations", SEED.locations.stockholm.name)}`)
    await expect(ui.heading(SEED.locations.stockholm.name)).toBeVisible()
    await expectAccessible(page)
    await ui.tab("JSON")
    await expect(main(page).getByRole("button", { name: "Replace (PUT)" })).toBeVisible()
    await expectAccessible(page)
  })

  const RESOURCE_TABS = [
    ["overview", "Overview", (page: Page) => main(page).getByText("Max simultaneous bookings")],
    ["services", "Services", (page: Page) => main(page).getByRole("combobox", { name: "Service to associate" }).and(page.locator(":enabled"))],
    ["blocks", "Schedule blocks", (page: Page) => main(page).getByRole("button", { name: /^Actions for block/ }).first()],
    ["recurring", "Recurring schedules", (page: Page) => main(page).getByRole("button", { name: "Add weekday hours" })],
    ["availability", "Availability", (page: Page) => main(page).getByText("Week overview")],
    ["json", "JSON", (page: Page) => main(page).getByRole("button", { name: "Replace (PUT)" })],
  ] as const
  for (const [tab, label, ready] of RESOURCE_TABS) {
    test(`resource detail: ${label} tab`, async ({ page, api, ui }) => {
      await page.goto(`/resources/${await api.idOf("resources", SEED.resources.ben.name)}?tab=${tab}`)
      await expect(ui.heading(SEED.resources.ben.name)).toBeVisible()
      await expect(page.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true")
      await expect(ready(page)).toBeVisible()
      await expectAccessible(page)
    })
  }

  for (const [tab, name, ready] of [
    ["overview", "Overview", (page: Page) => main(page).getByText("Duration", { exact: true })],
    ["resources", /^Resources/, (page: Page) => main(page).getByRole("table").getByText(SEED.resources.roomA.name)],
    ["slots", "Bookable slots", (page: Page) => main(page).getByText("Find bookable slots")],
  ] as const) {
    test(`service detail: ${tab} tab`, async ({ page, api, ui }) => {
      await page.goto(`/services/${await api.idOf("services", SEED.services.haircut.name)}?tab=${tab}`)
      await expect(ui.heading(SEED.services.haircut.name)).toBeVisible()
      await expect(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true")
      await expect(ready(page)).toBeVisible()
      await expectAccessible(page)
    })
  }

  test("booking detail", async ({ page, api, ui }) => {
    await page.goto(`/bookings/${(await api.bookingFor("Alva Lindqvist")).id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expectAccessible(page)
  })

  test("booking group detail", async ({ page, api, ui }) => {
    const [group] = await api.list<{ id: string }>("booking-groups")
    await page.goto(`/booking-groups/${group.id}`)
    await expect(ui.heading(/^Booking group/)).toBeVisible()
    await expect(main(page).getByRole("table").first()).toBeVisible()
    await expectAccessible(page)
  })

  test("new booking page", async ({ page, ui }) => {
    await page.goto("/bookings/new")
    await expect(page.locator('[data-slot="sidebar"]').getByText(SEED.project)).toBeVisible()
    await expect(ui.heading("New booking")).toBeVisible()
    await expectAccessible(page)
  })

  test("new booking group page", async ({ page, ui }) => {
    await page.goto("/booking-groups/new")
    await expect(page.locator('[data-slot="sidebar"]').getByText(SEED.project)).toBeVisible()
    await expect(ui.heading("New booking group")).toBeVisible()
    await expectAccessible(page)
  })

  for (const scheme of ["light", "dark"] as const) {
    test(`calendar week with canceled bookings and open time (${scheme})`, async ({ page, api }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await fixDateSubclassing(page)
      const anna = await api.idOf("resources", SEED.resources.anna.name)
      await page.goto(`/calendar?canceled=true&availability=true&resource=${anna}`)
      await expect(main(page).getByRole("link", { name: /Canceled: Haircut · Anna$/ })).toBeVisible()
      await expect(main(page).getByRole("img", { name: /^Open · / }).first()).toBeVisible()
      await expectAccessible(page)
    })
  }

  test("calendar list and month views", async ({ page }) => {
    await fixDateSubclassing(page)
    await page.goto("/calendar?view=list&canceled=true")
    await expect(main(page).getByRole("list", { name: "Events" }).first()).toBeVisible()
    await expectAccessible(page)
    await page.getByRole("radio", { name: "Month view" }).click()
    await expect(main(page).getByText("October 2026", { exact: true })).toBeVisible()
    await expectAccessible(page)
  })

  test("dark theme dashboard", async ({ page, ui }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(page.locator("html")).toHaveClass(/\bdark\b/)
    await expect(main(page).locator('[data-slot="card"] li')).toHaveCount(7)
    await expectAccessible(page)
  })

  test("not found page", async ({ page }) => {
    await page.goto("/no-such-page")
    await expect(page.getByText("This page could not be found.")).toBeVisible()
    await expectAccessible(page)
  })

  test("error alert on a detail page", async ({ page }) => {
    await page.goto("/locations/00000000-0000-4000-8000-000000000000")
    await expect(main(page).getByText("Request failed (404)")).toBeVisible()
    await expectAccessible(page)
  })
})

async function openDialog(page: Page, ui: Ui, button: string, title: string | RegExp) {
  await main(page).getByRole("button", { name: button, exact: true }).first().click()
  const dialog = ui.dialog(title)
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe("a11y: dialogs", () => {
  test("new location", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(main(page).getByRole("table").getByText(SEED.locations.stockholm.name)).toBeVisible()
    await openDialog(page, ui, "New location", "New location")
    await expectAccessible(page)
  })

  test("edit location", async ({ page, api, ui }) => {
    await page.goto(`/locations/${await api.idOf("locations", SEED.locations.stockholm.name)}`)
    await expect(ui.heading(SEED.locations.stockholm.name)).toBeVisible()
    const dialog = await openDialog(page, ui, "Edit", "Edit location")
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(SEED.locations.stockholm.name)
    await expectAccessible(page)
  })

  test("new resource", async ({ page, ui }) => {
    await page.goto("/resources")
    await expect(main(page).getByRole("table").getByText(SEED.resources.anna.name)).toBeVisible()
    await openDialog(page, ui, "New resource", "New resource")
    await expectAccessible(page)
  })

  for (const type of ["Fixed", "Flexible", "Day"]) {
    test(`new service: ${type} type`, async ({ page, ui }) => {
      await page.goto("/services")
      await expect(main(page).getByRole("table").getByText(SEED.services.haircut.name)).toBeVisible()
      const dialog = await openDialog(page, ui, "New service", "New service")
      const radio = dialog.getByRole("radio", { name: new RegExp(`^${type}`) })
      await radio.click()
      await expect(radio).toBeChecked()
      await expectAccessible(page)
    })
  }

  test("form validation errors", async ({ page, ui }) => {
    await page.goto("/resources")
    await expect(main(page).getByRole("table").getByText(SEED.resources.anna.name)).toBeVisible()
    const dialog = await openDialog(page, ui, "New resource", "New resource")
    await dialog.getByRole("button", { name: "Create resource" }).click()
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true")
    await expectAccessible(page)
  })

  test("edit booking", async ({ page, api, ui }) => {
    await page.goto(`/bookings/${(await api.bookingFor("Erik Lund")).id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await openDialog(page, ui, "Edit", "Edit booking")
    await expectAccessible(page)
  })

  test("cancel booking", async ({ page, api, ui }) => {
    await page.goto(`/bookings/${(await api.bookingFor("Erik Lund")).id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await main(page).getByRole("button", { name: "Cancel booking" }).click()
    await expect(page.getByRole("dialog").or(page.getByRole("alertdialog"))).toBeVisible()
    await expectAccessible(page)
  })

  test("edit booking group", async ({ page, api, ui }) => {
    const [group] = await api.list<{ id: string }>("booking-groups")
    await page.goto(`/booking-groups/${group.id}`)
    await expect(ui.heading(/^Booking group/)).toBeVisible()
    await openDialog(page, ui, "Edit", /^Edit booking group/)
    await expectAccessible(page)
  })

  test("new schedule block", async ({ page, api, ui }) => {
    await page.goto(`/resources/${await api.idOf("resources", SEED.resources.ben.name)}?tab=blocks`)
    await expect(main(page).getByRole("button", { name: /^Actions for block/ }).first()).toBeVisible()
    await openDialog(page, ui, "New block", "New schedule block")
    await expectAccessible(page)
  })

  test("new recurring schedule", async ({ page, api, ui }) => {
    await page.goto(`/resources/${await api.idOf("resources", SEED.resources.ben.name)}?tab=recurring`)
    await expect(main(page).getByRole("button", { name: "Add weekday hours" })).toBeVisible()
    await openDialog(page, ui, "New schedule", "New recurring schedule")
    await expectAccessible(page)
  })

  test("add weekday hours", async ({ page, api, ui }) => {
    await page.goto(`/resources/${await api.idOf("resources", SEED.resources.ben.name)}?tab=recurring`)
    await expect(main(page).getByRole("button", { name: "Add weekday hours" })).toBeVisible()
    await openDialog(page, ui, "Add weekday hours", "Add weekday hours")
    await expectAccessible(page)
  })

  test("add recurring block", async ({ page, api, ui }) => {
    await page.goto(`/resources/${await api.idOf("resources", SEED.resources.ben.name)}?tab=recurring`)
    await expect(main(page).getByRole("button", { name: "Add weekday hours" })).toBeVisible()
    await openDialog(page, ui, "Add block", "Add block")
    await expectAccessible(page)
  })

  test("Replace via JSON", async ({ page, api, ui }) => {
    await page.goto(`/services/${await api.idOf("services", SEED.services.studio.name)}?tab=json`)
    await expect(ui.heading(SEED.services.studio.name)).toBeVisible()
    const dialog = await openDialog(page, ui, "Replace (PUT)", "Replace via JSON")
    await expect(dialog.getByRole("textbox", { name: "JSON body" })).toHaveValue(/Studio rental/)
    await expectAccessible(page)
  })

  test("confirm delete (alert dialog)", async ({ page, api, ui }) => {
    await page.goto(`/locations/${await api.idOf("locations", SEED.locations.newYork.name)}`)
    await expect(ui.heading(SEED.locations.newYork.name)).toBeVisible()
    await main(page).getByRole("button", { name: "Delete" }).click()
    await expect(ui.alertDialog(`Delete ${SEED.locations.newYork.name}?`)).toBeVisible()
    await expectAccessible(page)
  })

  test("row actions menu", async ({ page, ui }) => {
    await page.goto("/resources")
    await expect(main(page).getByRole("table").getByText(SEED.resources.anna.name)).toBeVisible()
    await ui.row(SEED.resources.anna.name).getByRole("button", { name: /^Actions/ }).click()
    await expect(page.getByRole("menu")).toBeVisible()
    await expectAccessible(page)
  })

  test("mobile-width sidebar sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")
    await expect(main(page).getByText(`Project: ${SEED.project}`)).toBeVisible()
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeVisible()
    await expectAccessible(page)
  })
})

test.describe("a11y: colour contrast of the theme", () => {
  test("sidebar secondary text has enough contrast", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator('[data-slot="sidebar"]').getByText(SEED.project)).toBeVisible()
    await expectAccessible(page, { include: ['[data-slot="sidebar"]'] })
  })

  test("destructive text has enough contrast", async ({ page, api, ui }) => {
    // A canceled booking's badge, the Delete button and a destructive alert on one page.
    const booking = await api.bookingFor("Sara Ek")
    await page.goto(`/bookings/${booking.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(main(page).getByText("Canceled").first()).toBeVisible()
    await expectAccessible(page, { include: ["main"] })
  })

  test("inactive tabs have enough contrast", async ({ page, api, ui }) => {
    await page.goto(`/resources/${await api.idOf("resources", SEED.resources.anna.name)}`)
    await expect(ui.heading(SEED.resources.anna.name)).toBeVisible()
    await expectAccessible(page, { include: ['[role="tablist"]'] })
  })

  test("link buttons have enough contrast", async ({ page, api, ui }) => {
    await page.goto(`/bookings/${(await api.bookingFor("Erik Lund")).id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    const dialog = await openDialog(page, ui, "Edit", "Edit booking")
    await expect(dialog.getByRole("button", { name: "Show all" })).toBeVisible()
    await expectAccessible(page, { include: ['[role="dialog"]'] })
  })
})
