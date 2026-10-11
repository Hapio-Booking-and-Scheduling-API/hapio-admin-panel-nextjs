import type { Locator, Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { expectToast } from "../helpers/toasts"
import { exactly } from "../helpers/ui"
import { createResource } from "./_helpers"

const { anna, ben, roomA } = SEED.resources

/** The resources table's row whose name cell reads exactly `name`. */
function rowOf(page: Page, name: string) {
  return page.getByRole("row").filter({ has: page.getByRole("cell", { name, exact: true }) })
}

function nameCells(page: Page) {
  return page.getByRole("main").getByRole("table").first().locator("tbody tr td:first-child")
}

async function openFilters(page: Page) {
  await page.getByRole("button", { name: /^Filters/ }).click()
  const popover = page.locator('[data-slot="popover-content"]').last()
  await expect(popover.getByText("Advanced filters")).toBeVisible()
  return popover
}

function condition(popover: Locator, n: number) {
  return popover.getByRole("group", { name: `Condition ${n}` })
}

test.describe("resources list", () => {
  test("shows each resource's capacity, status and columns", async ({ page, api, ui }) => {
    await createResource(api, { name: "Studio C", max_simultaneous_bookings: null })
    await page.goto("/resources")
    await expect(rowOf(page, anna.name)).toBeVisible()

    const table = ui.main().getByRole("table").first()
    await expect(table.getByRole("columnheader")).toHaveText([
      "Name",
      "Max simultaneous",
      "Status",
      "Metadata",
      "Created",
      "Actions",
    ])
    await expect(nameCells(page)).toHaveText([anna.name, ben.name, roomA.name, "Studio C"])
    await expect(rowOf(page, anna.name).getByRole("cell").nth(1)).toHaveText("1")
    await expect(rowOf(page, roomA.name).getByRole("cell").nth(1)).toHaveText("2")
    await expect(rowOf(page, "Studio C").getByRole("cell").nth(1)).toHaveText("Unlimited")
    await expect(rowOf(page, anna.name).getByRole("cell").nth(2)).toHaveText("Enabled")
    await expect(ui.paginationSummary()).toHaveText("1–4 of 4")
  })

  test("a row opens the resource", async ({ page, api, ui }) => {
    const room = await api.byName("resources", roomA.name)
    await page.goto("/resources")
    await rowOf(page, roomA.name).getByRole("cell", { name: roomA.name, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/resources/${room.id}$`))
    await expect(ui.heading(roomA.name)).toBeVisible()
  })

  test("filters disabled resources: show, hide, only", async ({ page, api, ui, net }) => {
    await api.patch(`resources/${await api.idOf("resources", ben.name)}`, { enabled: false })
    await page.goto("/resources")
    await expect(rowOf(page, ben.name).getByRole("cell").nth(2)).toHaveText("Disabled")
    const filter = page.getByRole("combobox", { name: "Filter disabled" })
    await expect(filter).toHaveText("Show disabled")
    await ui.expectRowCount(3)

    const hide = net.waitFor("GET", "resources", (c) => c.query.disabled === "exclude")
    await ui.choose(filter, "Hide disabled")
    await hide
    await expect(page).toHaveURL(/[?&]disabled=exclude/)
    await expect(nameCells(page)).toHaveText([anna.name, roomA.name])

    await ui.choose(filter, "Only disabled")
    await expect(page).toHaveURL(/[?&]disabled=only/)
    await expect(nameCells(page)).toHaveText([ben.name])

    await page.getByRole("button", { name: "Reset" }).click()
    await expect(filter).toHaveText("Show disabled")
    await expect(page).not.toHaveURL(/disabled=/)
    await ui.expectRowCount(3)
  })

  test("advanced filter on max simultaneous bookings", async ({ page, ui, net }) => {
    await page.goto("/resources")
    await expect(rowOf(page, anna.name)).toBeVisible()

    const popover = await openFilters(page)
    const row = condition(popover, 1)
    await ui.choose(row.getByRole("combobox", { name: "Field" }), "Max simultaneous")
    await expect(row.getByRole("combobox", { name: "Operator" })).toHaveText("≥")
    await row.getByRole("spinbutton", { name: "Value" }).fill("2")
    const request = net.waitFor("GET", "resources", (c) => c.query["max_simultaneous_bookings[gte]"] === "2")
    await popover.getByRole("button", { name: "Apply" }).click()
    await request

    await expect(nameCells(page)).toHaveText([roomA.name])
    await expect(page.getByRole("button", { name: "Filters 1" })).toBeVisible()
    const chip = page.getByRole("button", { name: "Remove filter: Max simultaneous ≥ 2" })
    await expect(chip).toBeVisible()

    await chip.click()
    await expect(nameCells(page)).toHaveText([anna.name, ben.name, roomA.name])
    await expect(page).not.toHaveURL(/[?&]f=/)
  })

  test("advanced filter on metadata compared as text", async ({ page, ui, net }) => {
    await page.goto("/resources")
    await expect(rowOf(page, anna.name)).toBeVisible()

    const popover = await openFilters(page)
    const row = condition(popover, 1)
    await ui.choose(row.getByRole("combobox", { name: "Field" }), "Metadata")
    // Switching to a metadata field resets the operator to "=".
    await expect(row.getByRole("combobox", { name: "Operator" })).toHaveText("=")
    await ui.choose(row.getByRole("combobox", { name: "Operator" }), "= (string)")
    await row.getByRole("textbox", { name: "Property" }).fill("role")
    await row.getByRole("textbox", { name: "Value" }).fill("stylist")
    const request = net.waitFor("GET", "resources", (c) => c.query["metadata[role][seq]"] === "stylist")
    await popover.getByRole("button", { name: "Apply" }).click()
    await request

    await expect(nameCells(page)).toHaveText([anna.name, ben.name])
    await expect(page.getByRole("button", { name: "Remove filter: Metadata role = (string) stylist" })).toBeVisible()
    // The applied rows live in the URL, so they survive a reload.
    await page.reload()
    await expect(nameCells(page)).toHaveText([anna.name, ben.name])
  })

  test("an incomplete metadata condition (no property) isn't applied", async ({ page, ui, net }) => {
    await page.goto("/resources")
    await expect(rowOf(page, anna.name)).toBeVisible()
    const popover = await openFilters(page)
    const row = condition(popover, 1)
    await ui.choose(row.getByRole("combobox", { name: "Field" }), "Metadata")
    await row.getByRole("textbox", { name: "Value" }).fill("stylist")
    await popover.getByRole("button", { name: "Apply" }).click()
    await expect(popover).toBeHidden()
    await expect(page.getByRole("button", { name: exactly("Filters") })).toBeVisible()
    await ui.expectRowCount(3)
    expect(net.find("GET", "resources").some((c) => Object.keys(c.query).some((k) => k.startsWith("metadata[")))).toBe(false)
  })

  test(
    "switching a condition from metadata to a plain field resets a text-only operator",
    async ({ page, ui }) => {
      await page.goto("/resources")
      await expect(rowOf(page, anna.name)).toBeVisible()
      const popover = await openFilters(page)
      const row = condition(popover, 1)
      await ui.choose(row.getByRole("combobox", { name: "Field" }), "Metadata")
      await ui.choose(row.getByRole("combobox", { name: "Operator" }), "= (string)")
      await ui.choose(row.getByRole("combobox", { name: "Field" }), "Max simultaneous")
      // Today the row keeps "seq", which isn't an option for numbers: the trigger goes blank
      // and applying sends max_simultaneous_bookings[seq]=…
      await expect(row.getByRole("combobox", { name: "Operator" })).toHaveText(/^[=<>≤≥]$/)
    }
  )

  test("sorts by name and by created date", async ({ page, ui }) => {
    await page.goto("/resources")
    await expect(nameCells(page)).toHaveText([anna.name, ben.name, roomA.name])
    const table = ui.main().getByRole("table").first()

    await table.getByRole("button", { name: "Name" }).click()
    await expect(page).toHaveURL(/[?&]sort=name\.asc/)
    await expect(nameCells(page)).toHaveText([anna.name, ben.name, roomA.name])

    await table.getByRole("button", { name: "Name" }).click()
    await expect(page).toHaveURL(/[?&]sort=name\.desc/)
    await expect(nameCells(page)).toHaveText([roomA.name, ben.name, anna.name])

    await table.getByRole("button", { name: "Name" }).click()
    await expect(page).not.toHaveURL(/sort=/)

    await table.getByRole("button", { name: "Created" }).click()
    await table.getByRole("button", { name: "Created" }).click()
    await expect(page).toHaveURL(/[?&]sort=created_at\.desc/)
    await expect(nameCells(page)).toHaveText([roomA.name, ben.name, anna.name])
  })

  test("row actions disable and enable a resource", async ({ page, api, net }) => {
    const id = await api.idOf("resources", anna.name)
    await page.goto("/resources")
    const row = rowOf(page, anna.name)
    await expect(row).toBeVisible()

    await row.getByRole("button", { name: `Actions for ${anna.name}` }).click()
    await expect(page.getByRole("menuitem")).toHaveText(["Edit", "Disable", "Delete"])
    const patch = net.waitFor("PATCH", `resources/${id}`)
    await page.getByRole("menuitem", { name: "Disable" }).click()
    expect((await patch).body).toEqual({ enabled: false })
    await expectToast(page, "Resource disabled", { type: "success" })
    await expect(row.getByRole("cell").nth(2)).toHaveText("Disabled")
    expect((await api.get(`resources/${id}`)).enabled).toBe(false)

    // When the closed toast leaves, sonner hands focus back to the trigger, which would close a menu opened meanwhile.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
    await row.getByRole("button", { name: `Actions for ${anna.name}` }).click()
    await page.getByRole("menuitem", { name: "Enable" }).click()
    await expectToast(page, "Resource enabled")
    await expect(row.getByRole("cell").nth(2)).toHaveText("Enabled")
  })

  test("row action edits a resource", async ({ page, api, ui, net }) => {
    const id = await api.idOf("resources", anna.name)
    await page.goto("/resources")
    await rowOf(page, anna.name).getByRole("button", { name: `Actions for ${anna.name}` }).click()
    await page.getByRole("menuitem", { name: "Edit" }).click()

    const dialog = ui.dialog("Edit resource")
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(anna.name)
    await dialog.getByRole("textbox", { name: "Name" }).fill("Anna B")
    const patch = net.waitFor("PATCH", `resources/${id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toEqual({ name: "Anna B" })
    await expectToast(page, "Resource updated")
    await expect(dialog).toBeHidden()
    await expect(rowOf(page, "Anna B")).toBeVisible()
  })

  test("row action deletes a resource after confirming", async ({ page, api, ui }) => {
    await page.goto("/resources")
    await rowOf(page, ben.name).getByRole("button", { name: `Actions for ${ben.name}` }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()

    const confirm = ui.alertDialog(`Delete ${ben.name}?`)
    await expect(confirm).toContainText("permanently deletes the resource together with its schedule blocks")
    await expect(confirm).toContainText("Its bookings are kept but lose their resource.")
    await ui.dismiss(`Delete ${ben.name}?`)
    await expect(rowOf(page, ben.name)).toBeVisible()

    await rowOf(page, ben.name).getByRole("button", { name: `Actions for ${ben.name}` }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await ui.confirm(`Delete ${ben.name}?`, "Delete resource")
    await expectToast(page, "Resource deleted")
    await expect(nameCells(page)).toHaveText([anna.name, roomA.name])
    expect((await api.list<{ name: string }>("resources")).map((r) => r.name)).not.toContain(ben.name)
  })

  test("paginates with a page size", async ({ page, api, ui }) => {
    for (let i = 1; i <= 8; i++) await createResource(api, { name: `R0${i}` })
    await page.goto("/resources")
    await expect(ui.paginationSummary()).toHaveText("1–11 of 11")

    await ui.choose(page.getByRole("combobox", { name: "Rows per page" }), "10")
    await expect(page).toHaveURL(/[?&]per_page=10/)
    await expect(ui.paginationSummary()).toHaveText("1–10 of 11")
    await expect(ui.main().getByText("Page 1 of 2")).toBeVisible()
    await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled()

    await page.getByRole("button", { name: "Next page" }).click()
    await expect(page).toHaveURL(/[?&]page=2/)
    await expect(ui.paginationSummary()).toHaveText("11–11 of 11")
    await expect(nameCells(page)).toHaveText(["R08"])
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled()

    await page.getByRole("button", { name: "First page" }).click()
    await expect(page).not.toHaveURL(/[?&]page=/)
    await expect(nameCells(page).first()).toHaveText(anna.name)
  })

  test(
    "deleting the only row on the last page goes back a page",
    async ({ page, api, ui }) => {
      for (let i = 1; i <= 8; i++) await createResource(api, { name: `R0${i}` })
      await page.goto("/resources?per_page=10&page=2")
      await expect(nameCells(page)).toHaveText(["R08"])
      await ui.rowAction(rowOf(page, "R08"), "Delete")
      await ui.confirm("Delete R08?", "Delete resource")
      await expectToast(page, "Resource deleted")
      await expect(ui.paginationSummary()).toHaveText("1–10 of 10")
    }
  )

  test("no matches for active filters: explains and offers reset, not create", async ({ page, ui }) => {
    await page.goto("/resources?disabled=only")
    const empty = ui.main().locator('[data-slot="empty"]')
    await expect(empty).toContainText("No resources match these filters.")
    await expect(empty.getByRole("button", { name: "New resource" })).toHaveCount(0)
    await page.getByRole("button", { name: "Reset" }).click()
    await ui.expectRowCount(3)
  })
})

test.describe("resources list without data", () => {
  test.use({ seed: "empty" })

  test("the empty state offers to create the first resource", async ({ page, ui }) => {
    await page.goto("/resources")
    const empty = ui.main().locator('[data-slot="empty"]')
    await expect(empty).toContainText("No resources")
    await expect(empty).toContainText("Create your first resource to start scheduling.")
    await expect(ui.paginationSummary()).toHaveText("No results")

    await empty.getByRole("button", { name: "New resource" }).click()
    const dialog = ui.dialog("New resource")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused()
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()

    // The header button opens the same dialog.
    await ui.main().getByRole("button", { name: "New resource" }).first().click()
    await expect(ui.dialog("New resource")).toBeVisible()
  })
})
