import type { Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { expectToast } from "../helpers/toasts"
import { exactly } from "../helpers/ui"
import { rowAction } from "./_helpers"

const { haircut, studio, equipment } = SEED.services

/** Opens /services and waits for the API-derived rows. */
async function gotoList(page: Page, query = "") {
  await page.goto(`/services${query}`)
  await expect(page.getByRole("main").getByRole("table").getByText(studio.name)).toBeVisible()
}

const table = (page: Page) => page.getByRole("main").getByRole("table")
const nameCells = (page: Page) => table(page).locator("tbody tr td:first-child")
const filtersPopover = (page: Page) => page.locator('[data-slot="popover-content"]').filter({ hasText: "Advanced filters" })

test.describe("services list", () => {
  test("shows type, length and price for each type", async ({ page, ui }) => {
    await gotoList(page)
    await expect(table(page).getByRole("columnheader")).toHaveText(["Name", "Type", "Length", "Price", "Status", "Created", "Actions"])
    await expect(ui.row(haircut.name).getByRole("cell")).toHaveText([
      haircut.name,
      "Fixed",
      "45 min",
      "450.00",
      "Enabled",
      "30 Sep 2026, 06:07",
      "",
    ])
    await expect(ui.row(studio.name).getByRole("cell")).toHaveText([
      studio.name,
      "Flexible",
      "1 h – 4 h · step 30 min",
      "300.00/h",
      "Enabled",
      "30 Sep 2026, 06:08",
      "",
    ])
    await expect(ui.row(equipment.name).getByRole("cell")).toHaveText([
      equipment.name,
      "Day",
      "1–7 days",
      "150.00/day",
      "Enabled",
      "30 Sep 2026, 06:09",
      "",
    ])
    await expect(ui.paginationSummary()).toHaveText("1–3 of 3")
  })

  test("shows a dash for services without a price and other length summaries", async ({ page, api, ui }) => {
    const studioRental = await api.byName("services", studio.name)
    const equipmentRental = await api.byName("services", equipment.name)
    await api.patch(`services/${studioRental.id}`, { price: null, max_duration: null })
    await api.patch(`services/${equipmentRental.id}`, { min_days: 2, max_days: null })
    await gotoList(page)
    await expect(ui.row(studio.name).getByRole("cell").nth(2)).toHaveText("1 h – no max · step 30 min")
    await expect(ui.row(studio.name).getByRole("cell").nth(3)).toHaveText("—")
    await expect(ui.row(equipment.name).getByRole("cell").nth(2)).toHaveText("2 days – no max")
  })

  for (const [label, type, name] of [
    ["Fixed", "fixed", haircut.name],
    ["Flexible", "flexible", studio.name],
    ["Day", "day", equipment.name],
  ] as const) {
    test(`filters by service type: ${label}`, async ({ page, ui, net }) => {
      await gotoList(page)
      const request = net.waitFor("GET", "services", (c) => c.query.type === type)
      await ui.choose(page.getByRole("combobox", { name: "Service type" }), label)
      await request
      await expect(nameCells(page)).toHaveText([name])
      await expect(page).toHaveURL(new RegExp(`[?&]type=${type}`))
      await expect(page.getByRole("combobox", { name: "Service type" })).toHaveText(label)

      await ui.choose(page.getByRole("combobox", { name: "Service type" }), "Any type")
      await expect(nameCells(page)).toHaveCount(3)
      await expect(page).not.toHaveURL(/type=/)
    })
  }

  test("type filter from the URL survives a reload", async ({ page }) => {
    await page.goto("/services?type=day")
    await expect(nameCells(page)).toHaveText([equipment.name])
    await expect(page.getByRole("combobox", { name: "Service type" })).toHaveText("Day")
  })

  test("filters disabled services with the tri-state filter", async ({ page, api, ui, net }) => {
    const id = await api.idOf("services", studio.name)
    await api.patch(`services/${id}`, { enabled: false })
    await gotoList(page)
    const filter = page.getByRole("combobox", { name: "Filter disabled" })
    await expect(filter).toHaveText("Show disabled")
    await expect(ui.row(studio.name)).toContainText("Disabled")
    await expect(nameCells(page)).toHaveCount(3)

    let request = net.waitFor("GET", "services", (c) => c.query.disabled === "exclude")
    await ui.choose(filter, "Hide disabled")
    await request
    await expect(nameCells(page)).toHaveText([haircut.name, equipment.name])

    request = net.waitFor("GET", "services", (c) => c.query.disabled === "only")
    await ui.choose(filter, "Only disabled")
    await request
    await expect(nameCells(page)).toHaveText([studio.name])
    await expect(page).toHaveURL(/disabled=only/)

    await page.getByRole("button", { name: "Reset", exact: true }).click()
    await expect(nameCells(page)).toHaveCount(3)
    await expect(filter).toHaveText("Show disabled")
    await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeHidden()
  })

  test("advanced filter on name", async ({ page, ui, net }) => {
    await gotoList(page)
    await page.getByRole("button", { name: "Filters" }).click()
    const row = filtersPopover(page).getByRole("group", { name: "Condition 1" })
    await expect(row.getByRole("combobox", { name: "Field" })).toHaveText("Name")
    await ui.choose(row.getByRole("combobox", { name: "Operator" }), "=")
    await row.getByRole("textbox", { name: "Value" }).fill(haircut.name)
    const request = net.waitFor("GET", "services", (c) => c.query["name[eq]"] === haircut.name)
    await filtersPopover(page).getByRole("button", { name: "Apply" }).click()
    await request
    await expect(nameCells(page)).toHaveText([haircut.name])
    await expect(page.getByRole("button", { name: /^Filters\s*1$/ })).toBeVisible()

    await page.getByRole("button", { name: `Remove filter: Name = ${haircut.name}` }).click()
    await expect(nameCells(page)).toHaveCount(3)
    await expect(page.getByRole("button", { name: exactly("Filters") })).toBeVisible()
  })

  test("advanced filter on price normalises the value on blur", async ({ page, ui, net }) => {
    await gotoList(page)
    await page.getByRole("button", { name: "Filters" }).click()
    const row = filtersPopover(page).getByRole("group", { name: "Condition 1" })
    await ui.choose(row.getByRole("combobox", { name: "Field" }), "Price")
    await expect(row.getByRole("combobox", { name: "Operator" })).toHaveText("≥")
    const value = row.getByRole("textbox", { name: "Value" })
    await value.fill("300")
    await value.blur()
    await expect(value).toHaveValue("300.000")
    const request = net.waitFor("GET", "services", (c) => c.query["price[gte]"] === "300.000")
    await filtersPopover(page).getByRole("button", { name: "Apply" }).click()
    await request
    await expect(nameCells(page)).toHaveText([haircut.name, studio.name])
    await expect(page.getByRole("button", { name: "Remove filter: Price ≥ 300.000" })).toBeVisible()
  })

  test("advanced filter on created time", async ({ page, ui, net }) => {
    await gotoList(page)
    await page.getByRole("button", { name: "Filters" }).click()
    const row = filtersPopover(page).getByRole("group", { name: "Condition 1" })
    await ui.choose(row.getByRole("combobox", { name: "Field" }), "Created")
    // Studio rental was created at 06:08 UTC, i.e. 08:08 in Stockholm.
    await row.getByLabel("Value").fill("2026-09-30T08:08")
    const request = net.waitFor("GET", "services", (c) => c.query["created_at[gte]"] === "2026-09-30T08:08:00+02:00")
    await filtersPopover(page).getByRole("button", { name: "Apply" }).click()
    await request
    await expect(nameCells(page)).toHaveText([studio.name, equipment.name])
  })

  test("advanced filter on a metadata property", async ({ page, ui, net }) => {
    await gotoList(page)
    await page.getByRole("button", { name: "Filters" }).click()
    const row = filtersPopover(page).getByRole("group", { name: "Condition 1" })
    await ui.choose(row.getByRole("combobox", { name: "Field" }), "Metadata")
    await expect(row.getByRole("combobox", { name: "Operator" })).toHaveText("=")
    await row.getByRole("textbox", { name: "Property" }).fill("category")
    await row.getByRole("textbox", { name: "Value" }).fill("hair")
    const request = net.waitFor("GET", "services", (c) => c.query["metadata[category][eq]"] === "hair")
    await filtersPopover(page).getByRole("button", { name: "Apply" }).click()
    await request
    await expect(nameCells(page)).toHaveText([haircut.name])
    await expect(page.getByRole("button", { name: "Remove filter: Metadata category = hair" })).toBeVisible()
  })

  test("combines advanced filters and clears them", async ({ page, ui }) => {
    await gotoList(page)
    await page.getByRole("button", { name: "Filters" }).click()
    const popover = filtersPopover(page)
    await ui.choose(popover.getByRole("group", { name: "Condition 1" }).getByRole("combobox", { name: "Field" }), "Price")
    await popover.getByRole("group", { name: "Condition 1" }).getByRole("textbox", { name: "Value" }).fill("200")
    await popover.getByRole("button", { name: "Add condition" }).click()
    const second = popover.getByRole("group", { name: "Condition 2" })
    // Name ≥ "M" (text comparison) keeps Studio rental but not Haircut.
    await second.getByRole("textbox", { name: "Value" }).fill("M")
    await popover.getByRole("button", { name: "Apply" }).click()
    await expect(nameCells(page)).toHaveText([studio.name])
    await expect(page.getByRole("button", { name: /^Filters\s*2$/ })).toBeVisible()

    await page.getByRole("button", { name: /^Filters/ }).click()
    await filtersPopover(page).getByRole("button", { name: "Clear" }).click()
    await expect(nameCells(page)).toHaveCount(3)
    await expect(page).not.toHaveURL(/[?&]f=/)
  })

  test(
    "switching a condition from metadata to name drops the string operator",
    async ({ page, ui, net }) => {
      await gotoList(page)
      await page.getByRole("button", { name: "Filters" }).click()
      const row = filtersPopover(page).getByRole("group", { name: "Condition 1" })
      await ui.choose(row.getByRole("combobox", { name: "Field" }), "Metadata")
      await ui.choose(row.getByRole("combobox", { name: "Operator" }), "= (string)")
      await ui.choose(row.getByRole("combobox", { name: "Field" }), "Name")
      await row.getByRole("textbox", { name: "Value" }).fill(haircut.name)
      const request = net.waitFor("GET", "services", (c) => Object.keys(c.query).some((k) => k.startsWith("name[")))
      await filtersPopover(page).getByRole("button", { name: "Apply" }).click()
      const call = await request
      expect(Object.keys(call.query).filter((k) => k.startsWith("name["))).toEqual([
        expect.stringMatching(/^name\[(eq|lt|lte|gt|gte)\]$/),
      ])
    }
  )

  test("empty result with filters offers Reset filters", async ({ page, ui }) => {
    await page.goto("/services?type=day&disabled=only")
    await expect(page.getByText("No services", { exact: true })).toBeVisible()
    await expect(page.getByText("No services match these filters.")).toBeVisible()
    await page.getByRole("main").getByRole("button", { name: "Reset filters" }).click()
    await expect(nameCells(page)).toHaveCount(3)
    await expect(page).not.toHaveURL(/type=|disabled=/)
    await ui.expectRowCount(3)
  })

  test("row actions: edit opens the dialog with the service", async ({ page, ui }) => {
    await gotoList(page)
    await rowAction(ui.row(haircut.name), "Edit")
    const dialog = ui.dialog("Edit service")
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(haircut.name)
    await expect(dialog.getByRole("radio", { name: /^Fixed/ })).toBeChecked()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
  })

  test("row actions: disable and enable", async ({ page, ui, net, api }) => {
    await gotoList(page)
    const row = ui.row(studio.name)
    await expect(row.getByRole("button", { name: `Actions for ${studio.name}` })).toBeVisible()
    let patch = net.waitFor("PATCH", /^services\/[^/]+$/)
    await rowAction(row, "Disable")
    expect((await patch).body).toEqual({ enabled: false })
    await expectToast(page, "Service disabled", { type: "success" })
    await expect(row).toContainText("Disabled")
    expect((await api.byName<{ id: string; name: string; enabled: boolean }>("services", studio.name)).enabled).toBe(false)

    patch = net.waitFor("PATCH", /^services\/[^/]+$/)
    await rowAction(row, "Enable")
    expect((await patch).body).toEqual({ enabled: true })
    await expectToast(page, "Service enabled", { type: "success" })
    await expect(row).toContainText("Enabled")
  })

  test("row actions: delete asks first, then removes the service", async ({ page, ui, net, api }) => {
    await gotoList(page)
    await rowAction(ui.row(equipment.name), "Delete")
    const confirm = ui.alertDialog(`Delete ${equipment.name}?`)
    await expect(confirm).toContainText("Its bookings are kept but lose their service")
    await ui.dismiss(`Delete ${equipment.name}?`)
    await expect(ui.row(equipment.name)).toBeVisible()

    await rowAction(ui.row(equipment.name), "Delete")
    const request = net.waitFor("DELETE", /^services\/[^/]+$/)
    await ui.confirm(`Delete ${equipment.name}?`, "Delete service")
    await request
    await expectToast(page, "Service deleted", { type: "success" })
    await expect(nameCells(page)).toHaveText([haircut.name, studio.name])
    expect((await api.list("services")).map((s) => s.name)).not.toContain(equipment.name)
  })

  test("delete failure keeps the dialog open and shows the error", async ({ page, ui, net }) => {
    await gotoList(page)
    await net.fail(/^services\/[^/]+$/, { method: "DELETE", status: 500, body: { message: "Server exploded." } })
    await rowAction(ui.row(haircut.name), "Delete")
    await ui.alertDialog(`Delete ${haircut.name}?`).getByRole("button", { name: "Delete service" }).click()
    // The confirm dialog is modal, so leave the toast open.
    await expectToast(page, "Server exploded.", { type: "error", close: false })
    await expect(ui.alertDialog(`Delete ${haircut.name}?`)).toBeVisible()
    await ui.dismiss(`Delete ${haircut.name}?`)
    await expect(ui.row(haircut.name)).toBeVisible()
  })

  test("clicking a row opens the service", async ({ page, api, ui }) => {
    const id = await api.idOf("services", studio.name)
    await gotoList(page)
    await ui.row(studio.name).getByText("1 h – 4 h · step 30 min").click()
    await expect(page).toHaveURL(`/services/${id}`)
    await expect(ui.heading(studio.name)).toBeVisible()
  })

  test("sorts by name", async ({ page, net }) => {
    await gotoList(page)
    let request = net.waitFor("GET", "services", (c) => c.query.sort === "name.asc")
    await table(page).getByRole("button", { name: "Name" }).click()
    await request
    await expect(nameCells(page)).toHaveText([equipment.name, haircut.name, studio.name])
    request = net.waitFor("GET", "services", (c) => c.query.sort === "name.desc")
    await table(page).getByRole("button", { name: "Name" }).click()
    await request
    await expect(nameCells(page)).toHaveText([studio.name, haircut.name, equipment.name])
    await expect(page).toHaveURL(/sort=name\.desc/)
  })

  test("New service opens the create dialog", async ({ page, ui }) => {
    await gotoList(page)
    await page.getByRole("button", { name: "New service" }).click()
    const dialog = ui.dialog("New service")
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused()
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("")
    await expect(dialog.getByRole("radio", { name: /^Fixed/ })).toBeChecked()
    await expect(dialog.getByRole("button", { name: "Create service" })).toBeEnabled()
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
  })

  test("list load error offers a retry", async ({ page, net }) => {
    await net.fail("services", { method: "GET", status: 404, body: { message: "Not found." }, times: 1 })
    await page.goto("/services")
    await expect(page.getByRole("alert").filter({ hasText: "Request failed (404)" })).toBeVisible()
    await page.getByRole("button", { name: "Retry" }).click()
    await expect(nameCells(page)).toHaveCount(3)
  })

  test(
    "deleting the only row on the last page goes back a page",
    async ({ page, api, ui }) => {
      await Promise.all(
        Array.from({ length: 23 }, (_, i) =>
          api.post("services", { name: `Extra ${String(i + 1).padStart(2, "0")}`, type: "fixed", duration: "PT30M" })
        )
      )
      await page.goto("/services?page=2")
      await expect(ui.paginationSummary()).toHaveText("26–26 of 26")
      const last = page.getByRole("main").getByRole("table").locator("tbody tr")
      await expect(last).toHaveCount(1)
      const name = (await last.locator("td").first().textContent())!
      await rowAction(ui.row(name), "Delete")
      await ui.confirm(`Delete ${name}?`, "Delete service")
      await expectToast(page, "Service deleted")
      await expect(ui.paginationSummary()).toHaveText("1–25 of 25")
      await expect(page.getByText("Create your first service to start taking bookings.")).toHaveCount(0)
    }
  )
})

test.describe("services list without data", () => {
  test.use({ seed: "empty" })

  test("invites creating the first service", async ({ page, ui }) => {
    await page.goto("/services")
    await expect(page.getByText("Create your first service to start taking bookings.")).toBeVisible()
    await expect(ui.paginationSummary()).toHaveText("No results")
    await page.getByRole("main").getByRole("button", { name: "New service" }).last().click()
    await expect(ui.dialog("New service")).toBeVisible()
  })
})
