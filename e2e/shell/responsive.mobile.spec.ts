import type { Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { settleAnimations } from "../helpers/a11y"

// Runs in the "mobile" project (Pixel 7, 412 px wide): the sidebar becomes a sheet,
// tables drop secondary columns and nothing may scroll sideways.

const main = (page: Page) => page.getByRole("main")
const sheet = (page: Page) => page.getByRole("dialog", { name: "Sidebar" })

async function expectNoHorizontalOverflow(page: Page) {
  await settleAnimations(page)
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth, "page scrolls horizontally").toBeLessThanOrEqual(clientWidth)
}

test.describe("mobile: sidebar sheet", () => {
  test("the sidebar is hidden until opened with \"Toggle Sidebar\"", async ({ page }) => {
    await page.goto("/")
    await expect(main(page).getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(sheet(page)).toBeHidden()
    // Exact: the dashboard's own "Open Locations" link stays, only the sidebar's is gone.
    await expect(page.getByRole("link", { name: "Locations", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(sheet(page)).toBeVisible()
    await expect(sheet(page).getByText(SEED.project)).toBeVisible()
    await expect(sheet(page).getByRole("link", { name: "Dashboard" })).toHaveAttribute("data-active", "true")
  })

  test("navigating from the sheet closes it", async ({ page, ui }) => {
    await page.goto("/")
    await expect(main(page).getByText(`Project: ${SEED.project}`)).toBeVisible()
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await sheet(page).getByRole("link", { name: "Locations" }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/locations")
    await expect(sheet(page)).toBeHidden()
    await expect(ui.heading("Locations")).toBeVisible()
    await expect(main(page).getByText(SEED.locations.stockholm.name).first()).toBeVisible()

    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(sheet(page).getByRole("link", { name: "Locations" })).toHaveAttribute("data-active", "true")
    await sheet(page).getByRole("link", { name: /Hapio Admin/ }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/")
    await expect(sheet(page)).toBeHidden()
  })

  test("Escape closes the sheet", async ({ page }) => {
    await page.goto("/")
    await expect(main(page).getByText(`Project: ${SEED.project}`)).toBeVisible()
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(sheet(page)).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(sheet(page)).toBeHidden()
  })

  test("the sheet shows labels even if the desktop sidebar was collapsed", async ({ page, context, stack }) => {
    await context.addCookies([{ name: "sidebar_state", value: "false", url: stack.appUrl }])
    await page.goto("/")
    await expect(main(page).getByText(`Project: ${SEED.project}`)).toBeVisible()
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(sheet(page).getByText("Hapio API v1")).toBeVisible()
  })
})

test.describe("mobile: lists", () => {
  test("bookings: secondary columns are hidden, rows still open and act", async ({ page, api, ui }) => {
    await page.goto("/bookings")
    const table = main(page).getByRole("table")
    await expect(table.getByText("Studio rental").first()).toBeVisible()
    for (const header of ["When", "Service", "Status"]) {
      await expect(table.getByRole("columnheader", { name: header })).toBeVisible()
    }
    for (const header of ["Resource", "Location", "Price", "Group", "Created"]) {
      await expect(table.getByRole("columnheader", { name: header })).toBeHidden()
    }
    const booking = await api.bookingFor("Erik Lund")
    const actions = main(page).getByRole("button", { name: `Actions for booking ${booking.id.slice(0, 8)}` })
    await expect(actions).toBeVisible()
    await actions.click()
    await expect(page.getByRole("menu")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("menu")).toBeHidden()
    await ui.row("Thu 22 Oct").first().getByRole("cell").first().click()
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/)
    await expect(ui.heading("Haircut")).toBeVisible()
  })

  for (const [path, text, visible, hidden] of [
    ["/locations", SEED.locations.newYork.name, ["Name", "Time zone", "Status"], ["Selection", "Metadata", "Created"]],
    ["/resources", SEED.resources.roomA.name, ["Name"], ["Metadata"]],
    ["/services", SEED.services.equipment.name, ["Name"], ["Price"]],
  ] as const) {
    test(`${path}: secondary columns are hidden`, async ({ page }) => {
      await page.goto(path)
      const table = main(page).getByRole("table")
      await expect(table.getByText(text)).toBeVisible()
      for (const header of visible) await expect(table.getByRole("columnheader", { name: header })).toBeVisible()
      for (const header of hidden) await expect(table.getByRole("columnheader", { name: header })).toBeHidden()
    })
  }

  test("pagination stays reachable", async ({ page }) => {
    await page.goto("/bookings")
    await expect(main(page).getByRole("table").getByText("Studio rental").first()).toBeVisible()
    await expect(main(page).getByRole("combobox", { name: "Rows per page" })).toBeVisible()
    await expect(main(page).getByRole("button", { name: "Next page" })).toBeVisible()
  })
})

test.describe("mobile: no horizontal overflow", () => {
  for (const [path, ready] of [
    ["/", (page: Page) => main(page).getByText(`Project: ${SEED.project}`)],
    ["/bookings", (page: Page) => main(page).getByRole("table").getByText("Studio rental").first()],
    // The Status column ("2 confirmed") is hidden below 640 px; the row actions aren't.
    ["/booking-groups", (page: Page) => main(page).getByRole("table").getByRole("button", { name: /^Actions for group / }).first()],
    ["/locations", (page: Page) => main(page).getByRole("table").getByText(SEED.locations.stockholm.name)],
    ["/resources", (page: Page) => main(page).getByRole("table").getByText(SEED.resources.anna.name)],
    ["/services", (page: Page) => main(page).getByRole("table").getByText(SEED.services.haircut.name)],
    ["/project", (page: Page) => main(page).getByText("Project ID")],
    ["/bookings/new", (page: Page) => page.getByRole("heading", { level: 1, name: "New booking" })],
    ["/booking-groups/new", (page: Page) => page.getByRole("heading", { level: 1, name: "New booking group" })],
  ] as const) {
    test(path, async ({ page }) => {
      await page.goto(path)
      await expect(ready(page)).toBeVisible()
      await expectNoHorizontalOverflow(page)
    })
  }

  test("detail pages", async ({ page, api, ui }) => {
    const pages = [
      [`/locations/${await api.idOf("locations", SEED.locations.stockholm.name)}`, SEED.locations.stockholm.name],
      [`/services/${await api.idOf("services", SEED.services.studio.name)}`, SEED.services.studio.name],
      [`/bookings/${(await api.bookingFor("Pixel & Co")).id}`, "Studio rental"],
      [`/booking-groups/${(await api.list<{ id: string }>("booking-groups"))[0].id}`, /^Booking group/],
    ] as const
    for (const [path, heading] of pages) {
      await page.goto(path)
      await expect(ui.heading(heading)).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }
  })

  for (const tab of ["overview", "services", "blocks", "recurring", "availability", "json"]) {
    test(`resource detail: ${tab} tab`, async ({ page, api, ui }) => {
      await page.goto(`/resources/${await api.idOf("resources", SEED.resources.anna.name)}?tab=${tab}`)
      await expect(ui.heading(SEED.resources.anna.name)).toBeVisible()
      await expect(page.getByRole("tabpanel")).toBeVisible()
      await expectNoHorizontalOverflow(page)
    })
  }

  test("service bookable slots tab", async ({ page, api, ui }) => {
    await page.goto(`/services/${await api.idOf("services", SEED.services.haircut.name)}?tab=slots`)
    await expect(ui.heading(SEED.services.haircut.name)).toBeVisible()
    await expect(main(page).getByText("Find bookable slots")).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe("mobile: dialogs", () => {
  test("a long form dialog fits the screen and scrolls to its actions", async ({ page, ui }) => {
    await page.goto("/services")
    await expect(main(page).getByRole("table").getByText(SEED.services.haircut.name)).toBeVisible()
    await main(page).getByRole("button", { name: "New service" }).first().click()
    const dialog = ui.dialog("New service")
    await expect(dialog).toBeVisible()
    await settleAnimations(page)
    const viewport = page.viewportSize()!
    const box = (await dialog.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(viewport.height)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    // The body scrolls; header and footer stay put.
    const body = dialog.locator("form > div.overflow-y-auto")
    const { scrollHeight, clientHeight } = await body.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
    expect(scrollHeight).toBeGreaterThan(clientHeight)
    await expect(dialog.getByRole("button", { name: "Create service" })).toBeInViewport()
    await dialog.getByRole("radio", { name: /^Day/ }).click()
    const lastField = dialog.getByRole("textbox").last()
    await lastField.scrollIntoViewIfNeeded()
    await expect(lastField).toBeInViewport()
    await expect(dialog.getByRole("button", { name: "Create service" })).toBeInViewport()
    await expectNoHorizontalOverflow(page)
  })

  test("the booking edit dialog fits and scrolls", async ({ page, api, ui }) => {
    await page.goto(`/bookings/${(await api.bookingFor("Erik Lund")).id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await main(page).getByRole("button", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit booking")
    await expect(dialog).toBeVisible()
    await settleAnimations(page)
    const box = (await dialog.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await expect(dialog.getByRole("button", { name: "Save changes" })).toBeInViewport()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
  })

  test("confirm dialogs fit the screen", async ({ page, api, ui }) => {
    await page.goto(`/locations/${await api.idOf("locations", SEED.locations.newYork.name)}`)
    await expect(ui.heading(SEED.locations.newYork.name)).toBeVisible()
    await main(page).getByRole("button", { name: "Delete" }).click()
    const dialog = ui.alertDialog(`Delete ${SEED.locations.newYork.name}?`)
    await expect(dialog).toBeVisible()
    await settleAnimations(page)
    await expect(dialog.getByRole("button", { name: "Delete location" })).toBeInViewport()
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport()
    await expectNoHorizontalOverflow(page)
  })
})
