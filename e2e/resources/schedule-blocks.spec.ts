import type { Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import type { HapioApi } from "../fixtures/hapio-api"
import { expectToast } from "../helpers/toasts"
import {
  fieldError,
  fixDateSubclassing,
  formField,
  gotoResource,
  refetchOnReconnect,
  scheduleBlocksOf,
} from "./_helpers"

const { anna } = SEED.resources
const { stockholm, newYork } = SEED.locations
/** Anna's seed block: blocked Wed 28 Oct 12:00–14:00 at Stockholm Studio. */
const ANNA_BLOCK = "28 Oct 2026, 12:00"

// Zone conversions (TZDate) need Date subclassing, which the fake clock breaks.
test.beforeEach(async ({ page }) => fixDateSubclassing(page))

function urlParam(page: Page, key: string) {
  return new URL(page.url()).searchParams.get(key)
}

async function openBlocks(page: Page, api: HapioApi, query: Record<string, string> = {}) {
  const resource = await gotoResource(page, api, anna.name, { tab: "blocks", ...query })
  return resource
}

function blocksTable(page: Page) {
  return page.getByRole("main").getByRole("table")
}

function startCells(page: Page) {
  return blocksTable(page).locator("tbody tr td:nth-child(2)")
}

test.describe("schedule blocks list", () => {
  test("shows Anna's blocked lunch with location, times, duration and type", async ({ page, api, ui }) => {
    await openBlocks(page, api)
    const row = ui.row(ANNA_BLOCK)
    await expect(row).toBeVisible()
    await expect(blocksTable(page).getByRole("columnheader")).toHaveText([
      "Location",
      "Starts",
      "Ends",
      "Duration",
      "Type",
      "Actions",
    ])
    const cells = row.getByRole("cell")
    await expect(cells.nth(0)).toHaveText(`${stockholm.name}${stockholm.timeZone}`)
    await expect(cells.nth(1)).toHaveText(ANNA_BLOCK, { useInnerText: true })
    await expect(cells.nth(2)).toHaveText("14:00")
    await expect(cells.nth(3)).toHaveText("2 h")
    await expect(cells.nth(4)).toHaveText("Blocked")
    await expect(row.getByRole("button", { name: `Actions for block ${ANNA_BLOCK}` })).toBeVisible()
    await expect(row.getByRole("link", { name: stockholm.name })).toHaveAttribute(
      "href",
      `/locations/${await api.idOf("locations", stockholm.name)}`
    )
  })

  test("a block spanning days shows the full end date", async ({ page, api, ui }) => {
    const resource = await api.byName("resources", anna.name)
    await api.post(`resources/${resource.id}/schedule-blocks`, {
      location_id: await api.idOf("locations", stockholm.name),
      starts_at: "2026-11-06T18:00:00+01:00",
      ends_at: "2026-11-08T12:00:00+01:00",
      is_available: false,
    })
    await openBlocks(page, api)
    const row = ui.row("6 Nov 2026, 18:00")
    await expect(row.getByRole("cell").nth(2)).toHaveText("8 Nov 2026, 12:00")
    await expect(row.getByRole("cell").nth(3)).toHaveText("1 d 18 h")
  })

  test("filters by location, kept in sb_* URL keys apart from other tabs", async ({ page, api, ui }) => {
    const nyId = await api.idOf("locations", newYork.name)
    await openBlocks(page, api)
    await expect(ui.row(ANNA_BLOCK)).toBeVisible()

    const filter = ui.main().getByRole("combobox", { name: "Location filter" })
    await ui.pick(filter, newYork.name)
    await expect.poll(() => urlParam(page, "sb_location")).toBe(nyId)
    await expect(ui.main().getByText("No schedule blocks match these filters.")).toBeVisible()

    // The recurring schedules tab has its own filter, untouched.
    await ui.tab("Recurring schedules")
    await expect(ui.main().getByRole("combobox", { name: "Location filter" })).toHaveText("Any location")
    expect(urlParam(page, "rs_location")).toBeNull()
    expect(urlParam(page, "sb_location")).toBe(nyId)

    await ui.tab("Schedule blocks")
    await expect(ui.main().getByRole("combobox", { name: "Location filter" })).toHaveText(newYork.name)
    await ui.main().getByRole("button", { name: "Clear location filter" }).click()
    await expect(ui.row(ANNA_BLOCK)).toBeVisible()
    await expect.poll(() => urlParam(page, "sb_location")).toBeNull()
  })

  test("filters by a time window", async ({ page, api, ui, net }) => {
    await openBlocks(page, api)
    await expect(ui.row(ANNA_BLOCK)).toBeVisible()

    const request = net.waitFor("GET", /schedule-blocks$/, (c) => c.query.from === "2026-10-28T14:00:00+01:00")
    await ui.main().getByLabel("From").fill("2026-10-28T14:00")
    await request
    await expect.poll(() => urlParam(page, "sb_from")).toBe("2026-10-28T14:00:00+01:00")
    await expect(ui.main().getByText("No schedule blocks match these filters.")).toBeVisible()

    await ui.main().getByLabel("From").fill("2026-10-28T13:00")
    await expect(ui.row(ANNA_BLOCK)).toBeVisible()
    await ui.main().getByLabel("To").fill("2026-10-28T12:00")
    await expect.poll(() => urlParam(page, "sb_to")).toBe("2026-10-28T12:00:00+01:00")
    await expect(ui.main().getByText("No schedule blocks match these filters.")).toBeVisible()

    await ui.main().getByRole("button", { name: "Reset" }).click()
    await expect(ui.row(ANNA_BLOCK)).toBeVisible()
    await expect.poll(() => urlParam(page, "sb_from")).toBeNull()
    await expect.poll(() => urlParam(page, "sb_to")).toBeNull()
  })

  test("sorts with the sort picker and the column header", async ({ page, api, ui }) => {
    const resource = await api.byName("resources", anna.name)
    const location_id = await api.idOf("locations", stockholm.name)
    for (const [starts_at, ends_at] of [
      ["2026-11-02T09:00:00+01:00", "2026-11-02T10:00:00+01:00"],
      ["2026-10-24T10:00:00+02:00", "2026-10-24T14:00:00+02:00"],
    ]) {
      await api.post(`resources/${resource.id}/schedule-blocks`, { location_id, starts_at, ends_at, is_available: true })
    }
    await openBlocks(page, api)
    await expect(startCells(page)).toContainText([ANNA_BLOCK, "2 Nov 2026, 09:00", "24 Oct 2026, 10:00"])

    await ui.choose(ui.main().getByRole("combobox", { name: "Sort" }), "Starts ↓")
    await expect.poll(() => urlParam(page, "sb_sort")).toBe("starts_at.desc")
    await expect(startCells(page)).toContainText(["2 Nov 2026, 09:00", ANNA_BLOCK, "24 Oct 2026, 10:00"])

    // The column header cycles asc → desc → default; from "desc" it clears the sort.
    await blocksTable(page).getByRole("button", { name: "Starts" }).click()
    await expect.poll(() => urlParam(page, "sb_sort")).toBeNull()
    await expect(ui.main().getByRole("combobox", { name: "Sort" })).toHaveText("Default order")
    await blocksTable(page).getByRole("button", { name: "Starts" }).click()
    await expect.poll(() => urlParam(page, "sb_sort")).toBe("starts_at.asc")
    await expect(startCells(page)).toContainText(["24 Oct 2026, 10:00", ANNA_BLOCK, "2 Nov 2026, 09:00"])
    await expect(ui.row("24 Oct 2026, 10:00").getByRole("cell").nth(4)).toHaveText("Available")
    await expect(ui.main().getByRole("combobox", { name: "Sort" })).toHaveText("Starts ↑")
  })

  test("a resource without blocks shows the empty state", async ({ page, api, ui }) => {
    const ben = await api.byName("resources", SEED.resources.ben.name)
    for (const block of await scheduleBlocksOf(api, ben.id)) await api.delete(`resources/${ben.id}/schedule-blocks/${block.id}`)
    await gotoResource(page, api, SEED.resources.ben.name, { tab: "blocks" })
    const empty = ui.main().locator('[data-slot="empty"]')
    await expect(empty).toContainText("No schedule blocks")
    await expect(empty).toContainText("Add a block to open extra time or to block out time like holidays.")
    await empty.getByRole("button", { name: "New block" }).click()
    await expect(ui.dialog("New schedule block")).toBeVisible()
  })
})

test.describe("new schedule block", () => {
  test("defaults to tomorrow 09:00–17:00, available", async ({ page, api, ui }) => {
    await openBlocks(page, api)
    await expect(ui.row(ANNA_BLOCK)).toBeVisible()
    await ui.main().getByRole("button", { name: "New block" }).click()

    const dialog = ui.dialog("New schedule block")
    await expect(dialog.getByRole("combobox", { name: "Location" })).toHaveText("Select location…")
    await expect(dialog.getByLabel("Starts")).toHaveValue("2026-10-22T09:00")
    await expect(dialog.getByLabel("Ends")).toHaveValue("2026-10-22T17:00")
    await expect(formField(dialog, "Ends")).toContainText("Duration: 8 h")
    const type = dialog.getByRole("radiogroup", { name: "Type" })
    await expect(type.getByRole("radio", { name: /^Available/ })).toBeChecked()
    await expect(type.getByRole("radio", { name: /^Blocked \(unavailable\)/ })).not.toBeChecked()

    await dialog.getByRole("button", { name: "Create block" }).click()
    await expect(fieldError(dialog, "Location")).toHaveText("Required")
  })

  test("uses the filtered location and its time zone", async ({ page, api, ui }) => {
    await openBlocks(page, api, { sb_location: await api.idOf("locations", newYork.name) })
    await expect(ui.main().getByText("No schedule blocks match these filters.")).toBeVisible()
    await ui.main().getByRole("button", { name: "New block" }).click()
    const dialog = ui.dialog("New schedule block")
    await expect(dialog.getByRole("combobox", { name: "Location" })).toHaveText(newYork.name)
    await expect(formField(dialog, "Location")).toContainText("Times are in the location's time zone (America/New_York).")
    await expect(dialog.getByLabel("Starts")).toHaveValue("2026-10-22T09:00")
    await expect(dialog.getByLabel("Ends")).toHaveValue("2026-10-22T17:00")
  })

  test("the end must be after the start", async ({ page, api, ui, net }) => {
    await openBlocks(page, api)
    await expect(ui.row(ANNA_BLOCK)).toBeVisible()
    await ui.main().getByRole("button", { name: "New block" }).click()
    const dialog = ui.dialog("New schedule block")
    await ui.pick(dialog.getByRole("combobox", { name: "Location" }), stockholm.name)
    await dialog.getByLabel("Ends").fill("2026-10-22T08:00")
    await expect(formField(dialog, "Ends")).not.toContainText("Duration")
    await dialog.getByRole("button", { name: "Create block" }).click()
    await expect(fieldError(dialog, "Ends")).toHaveText("Must be after the start")
    expect(net.find("POST", /schedule-blocks$/)).toHaveLength(0)

    await dialog.getByLabel("Ends").fill("2026-10-22T10:30")
    await expect(fieldError(dialog, "Ends")).toHaveCount(0)
    await expect(formField(dialog, "Ends")).toContainText("Duration: 1 h 30 min")
  })

  test("an overlapping block shows the API error under Starts", async ({ page, api, ui }) => {
    await openBlocks(page, api)
    await expect(ui.row(ANNA_BLOCK)).toBeVisible()
    await ui.main().getByRole("button", { name: "New block" }).click()
    const dialog = ui.dialog("New schedule block")
    await ui.pick(dialog.getByRole("combobox", { name: "Location" }), stockholm.name)
    await dialog.getByLabel("Starts").fill("2026-10-28T13:00")
    await dialog.getByLabel("Ends").fill("2026-10-28T15:00")
    await dialog.getByRole("radio", { name: /^Blocked/ }).click()
    await dialog.getByRole("button", { name: "Create block" }).click()
    await expect(fieldError(dialog, "Starts")).toHaveText("The schedule block overlaps with another schedule block.")
    await expect(dialog).toBeVisible()
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
  })

  test("switching to a location in another zone keeps the wall-clock times", async ({ page, api, ui, net }) => {
    const resource = await openBlocks(page, api)
    const nyId = await api.idOf("locations", newYork.name)
    await expect(ui.row(ANNA_BLOCK)).toBeVisible()
    await ui.main().getByRole("button", { name: "New block" }).click()
    const dialog = ui.dialog("New schedule block")

    await ui.pick(dialog.getByRole("combobox", { name: "Location" }), stockholm.name)
    await expect(formField(dialog, "Location")).toContainText("(Europe/Stockholm)")
    await expect(dialog.getByLabel("Starts")).toHaveValue("2026-10-22T09:00")
    await ui.pick(dialog.getByRole("combobox", { name: "Location" }), newYork.name)
    await expect(formField(dialog, "Location")).toContainText("(America/New_York)")
    await expect(dialog.getByLabel("Starts")).toHaveValue("2026-10-22T09:00")
    await expect(dialog.getByLabel("Ends")).toHaveValue("2026-10-22T17:00")

    const post = net.waitFor("POST", `resources/${resource.id}/schedule-blocks`)
    await dialog.getByRole("button", { name: "Create block" }).click()
    expect((await post).body).toEqual({
      location_id: nyId,
      starts_at: "2026-10-22T09:00:00-04:00",
      ends_at: "2026-10-22T17:00:00-04:00",
      is_available: true,
    })
    await expectToast(page, "Schedule block created", { type: "success" })
    await expect(dialog).toBeHidden()
    const row = ui.row("22 Oct 2026, 09:00")
    await expect(row.getByRole("cell").nth(0)).toHaveText(`${newYork.name}${newYork.timeZone}`)
    await expect(row.getByRole("cell").nth(4)).toHaveText("Available")
    const created = (await scheduleBlocksOf(api, resource.id)).find((b) => b.location.id === nyId)
    expect(created?.starts_at).toBe("2026-10-22T09:00:00-04:00")
  })

  test("defaults use the location's zone even before locations have loaded", async ({ page, api, ui, net }) => {
    const resource = await api.byName("resources", anna.name)
    const nyId = await api.idOf("locations", newYork.name)
    await net.delay("locations", 5_000, { method: "GET" })
    await openBlocks(page, api, { sb_location: nyId })
    await expect(ui.main().getByText("No schedule blocks match these filters.")).toBeVisible()
    await ui.main().getByRole("button", { name: "New block" }).click()
    const dialog = ui.dialog("New schedule block")
    await expect(formField(dialog, "Location")).toContainText("(America/New_York)", { timeout: 10_000 })
    await expect(dialog.getByLabel("Starts")).toHaveValue("2026-10-22T09:00")
    await expect(dialog.getByLabel("Ends")).toHaveValue("2026-10-22T17:00")

    // The recomputed defaults aren't edits: they're sent as New York times.
    const post = net.waitFor("POST", `resources/${resource.id}/schedule-blocks`)
    await dialog.getByRole("button", { name: "Create block" }).click()
    expect((await post).body).toEqual({
      location_id: nyId,
      starts_at: "2026-10-22T09:00:00-04:00",
      ends_at: "2026-10-22T17:00:00-04:00",
      is_available: true,
    })
  })

  test("times typed before locations have loaded keep their wall-clock time", async ({ page, api, ui, net }) => {
    const nyId = await api.idOf("locations", newYork.name)
    await net.delay("locations", 5_000, { method: "GET" })
    await openBlocks(page, api, { sb_location: nyId })
    await expect(ui.main().getByText("No schedule blocks match these filters.")).toBeVisible()
    await ui.main().getByRole("button", { name: "New block" }).click()
    const dialog = ui.dialog("New schedule block")
    await expect(formField(dialog, "Location")).not.toContainText("America/New_York")
    await dialog.getByLabel("Starts").fill("2026-10-23T10:00")
    await expect(formField(dialog, "Location")).toContainText("(America/New_York)", { timeout: 10_000 })
    await expect(dialog.getByLabel("Starts")).toHaveValue("2026-10-23T10:00")
    await expect(dialog.getByLabel("Ends")).toHaveValue("2026-10-22T17:00")
  })
})

test.describe("edit and delete schedule blocks", () => {
  test("edits only the changed fields", async ({ page, api, ui, net }) => {
    const resource = await openBlocks(page, api)
    const [block] = await scheduleBlocksOf(api, resource.id)
    await ui.rowAction(ui.row(ANNA_BLOCK), "Edit")
    const dialog = ui.dialog("Edit schedule block")
    await expect(dialog.getByRole("combobox", { name: "Location" })).toHaveText(stockholm.name)
    await expect(dialog.getByLabel("Starts")).toHaveValue("2026-10-28T12:00")
    await expect(dialog.getByLabel("Ends")).toHaveValue("2026-10-28T14:00")
    await expect(dialog.getByRole("radio", { name: /^Blocked/ })).toBeChecked()

    await dialog.getByLabel("Ends").fill("2026-10-28T15:00")
    const patch = net.waitFor("PATCH", `resources/${resource.id}/schedule-blocks/${block.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toEqual({ ends_at: "2026-10-28T15:00:00+01:00" })
    await expectToast(page, "Schedule block updated")
    await expect(ui.row(ANNA_BLOCK).getByRole("cell").nth(2)).toHaveText("15:00")
    await expect(ui.row(ANNA_BLOCK).getByRole("cell").nth(3)).toHaveText("3 h")
  })

  test("changes the type of a block", async ({ page, api, ui, net }) => {
    const resource = await openBlocks(page, api)
    await ui.rowAction(ui.row(ANNA_BLOCK), "Edit")
    const dialog = ui.dialog("Edit schedule block")
    await dialog.getByRole("radio", { name: /^Available/ }).click()
    const patch = net.waitFor("PATCH", new RegExp(`^resources/${resource.id}/schedule-blocks/`))
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toEqual({ is_available: true })
    await expect(ui.row(ANNA_BLOCK).getByRole("cell").nth(4)).toHaveText("Available")
  })

  test("saving without changes sends nothing", async ({ page, api, ui, net }) => {
    await openBlocks(page, api)
    await ui.rowAction(ui.row(ANNA_BLOCK), "Edit")
    const dialog = ui.dialog("Edit schedule block")
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await expectToast(page, "No changes to save", { type: "info" })
    await expect(dialog).toBeHidden()
    expect(net.find("PATCH", /schedule-blocks\//)).toHaveLength(0)
  })

  test("keeps typed edits when the block list refetches", async ({ page, api, ui, net }) => {
    const resource = await openBlocks(page, api)
    const [block] = await scheduleBlocksOf(api, resource.id)
    await ui.rowAction(ui.row(ANNA_BLOCK), "Edit")
    const dialog = ui.dialog("Edit schedule block")
    await dialog.getByLabel("Ends").fill("2026-10-28T15:00")

    await api.patch(`resources/${resource.id}/schedule-blocks/${block.id}`, { starts_at: "2026-10-28T11:00:00+01:00" })
    await refetchOnReconnect(page)
    await expect(page.locator("main tbody")).toContainText("28 Oct 2026, 11:00")

    await expect(dialog.getByLabel("Ends")).toHaveValue("2026-10-28T15:00")
    const patch = net.waitFor("PATCH", `resources/${resource.id}/schedule-blocks/${block.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toMatchObject({ ends_at: "2026-10-28T15:00:00+01:00" })
  })

  test("deleting the only block on the last page goes back a page", async ({ page, api, ui }) => {
    const resource = await api.byName("resources", anna.name)
    const location_id = await api.idOf("locations", stockholm.name)
    for (let day = 2; day <= 11; day++) {
      const date = `2026-11-${String(day).padStart(2, "0")}`
      await api.post(`resources/${resource.id}/schedule-blocks`, {
        location_id,
        starts_at: `${date}T09:00:00+01:00`,
        ends_at: `${date}T10:00:00+01:00`,
        is_available: true,
      })
    }
    await openBlocks(page, api, { sb_per_page: "10", sb_page: "2" })
    await expect(ui.paginationSummary()).toHaveText("11–11 of 11")
    const rows = blocksTable(page).locator("tbody tr")
    await expect(rows).toHaveCount(1)
    await ui.rowAction(rows.first(), "Delete")
    await ui.confirm("Delete schedule block?", "Delete block")
    await expectToast(page, "Schedule block deleted")
    await expect(ui.paginationSummary()).toHaveText("1–10 of 10")
    await expect.poll(() => urlParam(page, "sb_page")).toBeNull()
    await expect(rows).toHaveCount(10)
  })

  test("deletes a block after confirming", async ({ page, api, ui, net }) => {
    const resource = await openBlocks(page, api)
    const [block] = await scheduleBlocksOf(api, resource.id)
    await ui.rowAction(ui.row(ANNA_BLOCK), "Delete")
    const confirm = ui.alertDialog("Delete schedule block?")
    await expect(confirm).toContainText(
      `Blocked time at ${stockholm.name} from 28 Oct 2026, 12:00 to 28 Oct 2026, 14:00 will be removed.`
    )
    const del = net.waitFor("DELETE", `resources/${resource.id}/schedule-blocks/${block.id}`)
    await ui.confirm("Delete schedule block?", "Delete block")
    await del
    await expectToast(page, "Schedule block deleted")
    await expect(ui.main().locator('[data-slot="empty"]')).toContainText("No schedule blocks")
    expect(await scheduleBlocksOf(api, resource.id)).toEqual([])
  })
})
