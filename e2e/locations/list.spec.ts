import { expect, test } from "../fixtures/test"
import { expectAccessible } from "../helpers/a11y"
import { recordAppearances } from "../helpers/flash"
import { expectNoToast, expectToast } from "../helpers/toasts"
import {
  NEW_YORK,
  STOCKHOLM,
  allChipRemoves,
  chipRemove,
  condition,
  createLocations,
  filterKeys,
  filtersButton,
  locationsTable,
  nameCells,
  openFilters,
  setCondition,
  sortButton,
  urlParam,
  wallTime,
  type LocationJson,
} from "./_helpers"

const EMPTY_FILTERED = "No locations match these filters."
const EMPTY_FIRST = "Create your first location to get started."

test.describe("locations list: table", () => {
  test("shows columns, badges and metadata previews", async ({ page, api, ui }) => {
    await api.post("locations", {
      name: "Oslo Office",
      time_zone: "Europe/Oslo",
      resource_selection_strategy: "equalize",
      enabled: false,
      metadata: { a: 1, b: 2, c: 3, d: 4, e: 5 },
    })
    await api.post("locations", {
      name: "Paris Atelier",
      time_zone: "Europe/Paris",
      resource_selection_strategy: "randomize",
      metadata: {},
    })
    await api.post("locations", { name: "Rome Room", time_zone: "Europe/Rome", resource_selection_strategy: "randomize" })
    const stockholm = await api.byName<LocationJson>("locations", STOCKHOLM)
    const newYork = await api.byName<LocationJson>("locations", NEW_YORK)

    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK, "Oslo Office", "Paris Atelier", "Rome Room"])

    await expect(locationsTable(page).getByRole("columnheader")).toHaveText([
      "Name",
      "Time zone",
      "Selection",
      "Status",
      "Metadata",
      "Created",
      "Actions",
    ])
    await expect(ui.row(STOCKHOLM).getByRole("cell")).toHaveText([
      STOCKHOLM,
      "Europe/Stockholm",
      "Prioritize",
      "Enabled",
      "address, floor",
      wallTime(stockholm.created_at),
      "",
    ])
    await expect(ui.row(NEW_YORK).getByRole("cell")).toHaveText([
      NEW_YORK,
      "America/New_York",
      "Randomize",
      "Enabled",
      "address, floor",
      wallTime(newYork.created_at),
      "",
    ])
    // The metadata preview carries the full JSON as a tooltip.
    await expect(ui.row(STOCKHOLM).getByText("address, floor")).toHaveAttribute(
      "title",
      JSON.stringify(stockholm.metadata)
    )
    await expect(ui.row("Oslo Office").getByRole("cell").nth(2)).toHaveText("Equalize")
    await expect(ui.row("Oslo Office").getByRole("cell").nth(3)).toHaveText("Disabled")
    await expect(ui.row("Oslo Office").getByRole("cell").nth(4)).toHaveText("a, b, c +2")
    await expect(ui.row("Paris Atelier").getByRole("cell").nth(4)).toHaveText("{}")
    await expect(ui.row("Rome Room").getByRole("cell").nth(4)).toHaveText("—")
    await expect(ui.paginationSummary()).toHaveText("1–5 of 5")
    await expect(ui.main().getByText("Page 1 of 1")).toBeVisible()
  })

  test("loads page 1 of 25, including disabled locations, unsorted", async ({ page, net, ui }) => {
    const request = net.waitFor("GET", "locations")
    await page.goto("/locations")
    await expect(ui.row(STOCKHOLM)).toBeVisible()
    expect((await request).query).toEqual({ page: "1", per_page: "25", disabled: "include" })
    await expect(page).toHaveURL(/\/locations$/)
  })

  for (const { header, asc, desc, key } of [
    {
      header: "Name" as const,
      key: "name",
      asc: [NEW_YORK, "Oslo Office", STOCKHOLM],
      desc: [STOCKHOLM, "Oslo Office", NEW_YORK],
    },
    {
      header: "Created" as const,
      key: "created_at",
      asc: [STOCKHOLM, NEW_YORK, "Oslo Office"],
      desc: ["Oslo Office", NEW_YORK, STOCKHOLM],
    },
  ]) {
    test(`sorts by ${header}: ascending, descending, then off`, async ({ page, api, net }) => {
      await api.post("locations", { name: "Oslo Office", time_zone: "Europe/Oslo", resource_selection_strategy: "randomize" })
      await page.goto("/locations")
      // Unsorted: the API's own order (creation order).
      await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK, "Oslo Office"])

      let request = net.waitFor("GET", "locations", (c) => c.query.sort === `${key}.asc`)
      await sortButton(page, header).click()
      expect((await request).query.sort).toBe(`${key}.asc`)
      await expect(page).toHaveURL(new RegExp(`[?&]sort=${key}\\.asc(&|$)`))
      await expect(nameCells(page)).toHaveText(asc)

      request = net.waitFor("GET", "locations", (c) => c.query.sort === `${key}.desc`)
      await sortButton(page, header).click()
      await request
      await expect(page).toHaveURL(new RegExp(`[?&]sort=${key}\\.desc(&|$)`))
      await expect(nameCells(page)).toHaveText(desc)

      // Off again: back to the unsorted query (served from the cache, no new request).
      await sortButton(page, header).click()
      await expect(page).not.toHaveURL(/sort=/)
      await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK, "Oslo Office"])
    })
  }

  test("switching the sort column starts ascending and resets to page 1", async ({ page, api }) => {
    await createLocations(api, 30)
    await page.goto("/locations?page=2&sort=name.desc")
    // Name descending: Stockholm Studio, New York Loft, Location 30 … 01; row 26 is Location 07.
    await expect(nameCells(page).first()).toHaveText("Location 07")
    await sortButton(page, "Created").click()
    await expect(page).toHaveURL(/[?&]sort=created_at\.asc(&|$)/)
    await expect(page).not.toHaveURL(/page=2/)
    await expect(nameCells(page).first()).toHaveText(STOCKHOLM)
  })

  test("the table and the filters popover have no serious accessibility violations", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(ui.row(STOCKHOLM)).toBeVisible()
    await expectAccessible(page, { include: "main" })
    await openFilters(page)
    await expectAccessible(page, { include: '[data-slot="popover-content"]' })
  })

  test("headers without a sort key are not buttons", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(ui.row(STOCKHOLM)).toBeVisible()
    for (const header of ["Time zone", "Selection", "Status", "Metadata"]) {
      await expect(locationsTable(page).getByRole("columnheader", { name: header })).toBeVisible()
      await expect(locationsTable(page).getByRole("columnheader", { name: header }).getByRole("button")).toHaveCount(0)
    }
  })
})

test.describe("locations list: filters", () => {
  test("disabled filter: hide, only and show after disabling a location", async ({ page, net, ui }) => {
    await page.goto("/locations")
    await expect(ui.row(NEW_YORK)).toBeVisible()

    const patch = net.waitFor("PATCH", (p) => p.startsWith("locations/"))
    await ui.rowAction(ui.row(NEW_YORK), "Disable")
    expect((await patch).body).toEqual({ enabled: false })
    await expectToast(page, "Location disabled", { type: "success" })
    await expect(ui.row(NEW_YORK).getByText("Disabled", { exact: true })).toBeVisible()

    const filter = page.getByRole("combobox", { name: "Filter disabled" })
    await expect(filter).toHaveText("Show disabled")

    let request = net.waitFor("GET", "locations", (c) => c.query.disabled === "exclude")
    await ui.choose(filter, "Hide disabled")
    await request
    await expect(page).toHaveURL(/[?&]disabled=exclude(&|$)/)
    await expect(nameCells(page)).toHaveText([STOCKHOLM])

    request = net.waitFor("GET", "locations", (c) => c.query.disabled === "only")
    await ui.choose(filter, "Only disabled")
    await request
    await expect(page).toHaveURL(/[?&]disabled=only(&|$)/)
    await expect(nameCells(page)).toHaveText([NEW_YORK])

    await ui.choose(filter, "Show disabled")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    await expect(page).not.toHaveURL(/disabled=/)
  })

  test("enabling a disabled location from the row menu", async ({ page, api, net, ui }) => {
    const ny = await api.byName("locations", NEW_YORK)
    await api.patch(`locations/${ny.id}`, { enabled: false })
    await page.goto("/locations")
    await expect(ui.row(NEW_YORK).getByText("Disabled", { exact: true })).toBeVisible()

    const patch = net.waitFor("PATCH", `locations/${ny.id}`)
    await ui.rowAction(ui.row(NEW_YORK), "Enable")
    expect((await patch).body).toEqual({ enabled: true })
    await expectToast(page, "Location enabled", { type: "success" })
    await expect(ui.row(NEW_YORK).getByText("Enabled", { exact: true })).toBeVisible()
    expect((await api.get<LocationJson>(`locations/${ny.id}`)).enabled).toBe(true)
  })

  test("time zone filter: pick a zone, then clear it", async ({ page, net, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

    const combobox = page.getByRole("combobox", { name: "Time zone filter" })
    await expect(combobox).toHaveText("Any time zone")
    await expect(page.getByRole("button", { name: "Clear time zone filter" })).toHaveCount(0)

    const request = net.waitFor("GET", "locations", (c) => c.query.timezone === "America/New_York")
    await ui.pick(combobox, "America/New_York", { search: "New_York" })
    await request
    await expect(combobox).toHaveText("America/New_York")
    await expect(page).toHaveURL(/[?&]timezone=America(%2F|\/)New_York(&|$)/)
    await expect(nameCells(page)).toHaveText([NEW_YORK])

    // Clearing returns to the cached unfiltered query.
    await page.getByRole("button", { name: "Clear time zone filter" }).click()
    await expect(combobox).toHaveText("Any time zone")
    await expect(page).not.toHaveURL(/timezone=/)
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
  })

  test("selection strategy filter", async ({ page, net, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

    const select = page.getByRole("combobox", { name: "Selection strategy" })
    await expect(select).toHaveText("Any strategy")

    const request = net.waitFor("GET", "locations", (c) => c.query.resource_selection_strategy === "prioritize")
    await ui.choose(select, "Prioritize")
    await request
    await expect(page).toHaveURL(/[?&]strategy=prioritize(&|$)/)
    await expect(nameCells(page)).toHaveText([STOCKHOLM])

    await ui.choose(select, "Randomize")
    await expect(nameCells(page)).toHaveText([NEW_YORK])

    await ui.choose(select, "Equalize")
    await expect(ui.main().getByText(EMPTY_FILTERED)).toBeVisible()
    await expect(ui.main().getByText("No locations", { exact: true })).toBeVisible()
    await expect(ui.paginationSummary()).toHaveText("No results")

    await ui.choose(select, "Any strategy")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    await expect(page).not.toHaveURL(/strategy=/)
  })

  test("Reset is only offered while a filter is active, and clears all of them", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(ui.row(STOCKHOLM)).toBeVisible()
    const reset = ui.main().getByRole("button", { name: "Reset", exact: true })
    await expect(reset).toHaveCount(0)

    await ui.choose(page.getByRole("combobox", { name: "Selection strategy" }), "Randomize")
    await expect(reset).toBeVisible()
    await ui.choose(page.getByRole("combobox", { name: "Filter disabled" }), "Hide disabled")
    await ui.pick(page.getByRole("combobox", { name: "Time zone filter" }), "America/New_York", { search: "New_York" })
    const popover = await openFilters(page)
    await setCondition(ui, condition(popover, 1), { op: "=", value: NEW_YORK })
    await popover.getByRole("button", { name: "Apply" }).click()
    await expect(nameCells(page)).toHaveText([NEW_YORK])
    await expect(allChipRemoves(page)).toHaveCount(1)

    // Reset returns to the unfiltered query, which is still cached (no new request needed).
    await reset.click()
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    await expect(reset).toHaveCount(0)
    await expect(allChipRemoves(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/locations$/)
    await expect(page.getByRole("combobox", { name: "Selection strategy" })).toHaveText("Any strategy")
    await expect(page.getByRole("combobox", { name: "Filter disabled" })).toHaveText("Show disabled")
    await expect(page.getByRole("combobox", { name: "Time zone filter" })).toHaveText("Any time zone")
  })

  test("the disabled filter alone counts as active (Hide/Only)", async ({ page, ui }) => {
    await page.goto("/locations?disabled=only")
    await expect(ui.main().getByText(EMPTY_FILTERED)).toBeVisible()
    await expect(ui.main().getByRole("button", { name: "Reset", exact: true })).toBeVisible()
  })

  test("changing a filter goes back to page 1", async ({ page, api, net, ui }) => {
    await createLocations(api, 30)
    await page.goto("/locations?page=2")
    await expect(ui.paginationSummary()).toHaveText("26–32 of 32")

    const request = net.waitFor("GET", "locations", (c) => c.query.resource_selection_strategy === "randomize")
    await ui.choose(page.getByRole("combobox", { name: "Selection strategy" }), "Randomize")
    expect((await request).query.page).toBe("1")
    await expect(page).not.toHaveURL(/page=2/)
    await expect(ui.paginationSummary()).toHaveText("1–25 of 31")
  })
})

test.describe("locations list: advanced filters", () => {
  test("Name = filters by exact name and shows a chip", async ({ page, net, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    await expect(filtersButton(page)).toHaveText("Filters")

    const popover = await openFilters(page)
    const row = condition(popover, 1)
    // A new condition starts on the first field.
    await expect(row.getByRole("combobox", { name: "Field" })).toHaveText("Name")
    await expect(row.getByRole("textbox", { name: "Property" })).toHaveCount(0)
    await setCondition(ui, row, { op: "=", value: STOCKHOLM })

    const request = net.waitFor("GET", "locations", (c) => filterKeys(c.query).length > 0)
    await popover.getByRole("button", { name: "Apply" }).click()
    const { query } = await request
    expect(filterKeys(query)).toEqual(["name[eq]"])
    expect(query["name[eq]"]).toBe(STOCKHOLM)
    await expect(popover).toBeHidden()
    await expect(nameCells(page)).toHaveText([STOCKHOLM])
    await expect(chipRemove(page, "Name", "=", STOCKHOLM)).toBeVisible()
    await expect(filtersButton(page)).toHaveText("Filters1")
    await expect.poll(() => JSON.parse(urlParam(page, "f") ?? "null")).toEqual([{ field: "name", op: "eq", value: STOCKHOLM }])
  })

  test("Created ≥ a moment (entered in the browser's zone)", async ({ page, api, net, ui }) => {
    await api.post("locations", { name: "Oslo Office", time_zone: "Europe/Oslo", resource_selection_strategy: "randomize" })
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK, "Oslo Office"])

    const popover = await openFilters(page)
    const row = condition(popover, 1)
    await setCondition(ui, row, { field: "Created" })
    // The operator survives the switch between comparable fields.
    await expect(row.getByRole("combobox", { name: "Operator" })).toHaveText("≥")
    await setCondition(ui, row, { value: "2026-10-21T00:00" })

    const request = net.waitFor("GET", "locations", (c) => filterKeys(c.query).length > 0)
    await popover.getByRole("button", { name: "Apply" }).click()
    const { query } = await request
    expect(query["created_at[gte]"]).toBe("2026-10-21T00:00:00+02:00")
    expect(filterKeys(query)).toEqual(["created_at[gte]"])
    await expect(nameCells(page)).toHaveText(["Oslo Office"])
    await expect(chipRemove(page, "Created", "≥", "21 Oct 2026, 00:00")).toBeVisible()
  })

  test("Metadata floor ≥ 3 compares numbers", async ({ page, net, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

    const popover = await openFilters(page)
    const row = condition(popover, 1)
    await setCondition(ui, row, { field: "Metadata" })
    // Metadata rows start with "=" and ask for a property.
    await expect(row.getByRole("combobox", { name: "Operator" })).toHaveText("=")
    await setCondition(ui, row, { op: "≥", property: "floor", value: "3" })

    const request = net.waitFor("GET", "locations", (c) => filterKeys(c.query).length > 0)
    await popover.getByRole("button", { name: "Apply" }).click()
    const { query } = await request
    expect(filterKeys(query)).toEqual(["metadata[floor][gte]"])
    expect(query["metadata[floor][gte]"]).toBe("3")
    await expect(nameCells(page)).toHaveText([NEW_YORK])
    await expect(chipRemove(page, "Metadata", "≥", "3", "floor")).toBeVisible()
  })

  test("nested metadata properties use ->", async ({ page, api, net, ui }) => {
    const stockholm = await api.byName<LocationJson>("locations", STOCKHOLM)
    await api.patch(`locations/${stockholm.id}`, { metadata: { ...stockholm.metadata, manager: { name: "Eva" } } })
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

    const popover = await openFilters(page)
    await setCondition(ui, condition(popover, 1), { field: "Metadata", property: "manager->name", value: "Eva" })
    const request = net.waitFor("GET", "locations", (c) => filterKeys(c.query).length > 0)
    await popover.getByRole("button", { name: "Apply" }).click()
    const { query } = await request
    expect(query["metadata[manager->name][eq]"]).toBe("Eva")
    await expect(nameCells(page)).toHaveText([STOCKHOLM])
    await expect(chipRemove(page, "Metadata", "=", "Eva", "manager->name")).toBeVisible()
  })

  test("string operator = (string) compares as text", async ({ page, net, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

    const popover = await openFilters(page)
    await setCondition(ui, condition(popover, 1), { field: "Metadata", op: "= (string)", property: "floor", value: "5" })
    const request = net.waitFor("GET", "locations", (c) => filterKeys(c.query).length > 0)
    await popover.getByRole("button", { name: "Apply" }).click()
    const { query } = await request
    expect(query["metadata[floor][seq]"]).toBe("5")
    await expect(nameCells(page)).toHaveText([NEW_YORK])
    await expect(chipRemove(page, "Metadata", "= (string)", "5", "floor")).toBeVisible()
  })

  test("Protected metadata filters use their own key", async ({ page, api, net, ui }) => {
    const ny = await api.byName("locations", NEW_YORK)
    await api.patch(`locations/${ny.id}`, { protected_metadata: { tier: "gold" } })
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

    const popover = await openFilters(page)
    await setCondition(ui, condition(popover, 1), { field: "Protected metadata", property: "tier", value: "gold" })
    const request = net.waitFor("GET", "locations", (c) => filterKeys(c.query).length > 0)
    await popover.getByRole("button", { name: "Apply" }).click()
    expect(filterKeys((await request).query)).toEqual(["protected_metadata[tier][eq]"])
    await expect(nameCells(page)).toHaveText([NEW_YORK])
  })

  test("several conditions apply together; chips remove one at a time", async ({ page, net, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

    const popover = await openFilters(page)
    await setCondition(ui, condition(popover, 1), { field: "Metadata", op: "≥", property: "floor", value: "2" })
    await popover.getByRole("button", { name: "Add condition" }).click()
    await setCondition(ui, condition(popover, 2), { op: "=", value: NEW_YORK })
    const request = net.waitFor("GET", "locations", (c) => filterKeys(c.query).length === 2)
    await popover.getByRole("button", { name: "Apply" }).click()
    const { query } = await request
    expect(query).toMatchObject({ "metadata[floor][gte]": "2", "name[eq]": NEW_YORK })
    await expect(nameCells(page)).toHaveText([NEW_YORK])
    await expect(allChipRemoves(page)).toHaveCount(2)
    await expect(filtersButton(page)).toHaveText("Filters2")

    const afterRemove = net.waitFor("GET", "locations", (c) => filterKeys(c.query).length === 1)
    await chipRemove(page, "Name", "=", NEW_YORK).click()
    expect(filterKeys((await afterRemove).query)).toEqual(["metadata[floor][gte]"])
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    await expect(allChipRemoves(page)).toHaveCount(1)

    await chipRemove(page, "Metadata", "≥", "2", "floor").click()
    await expect(allChipRemoves(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/[?&]f=/)
    await expect(filtersButton(page)).toHaveText("Filters")
  })

  test("Clear removes every condition", async ({ page, net }) => {
    const f = JSON.stringify([
      { field: "name", op: "eq", value: STOCKHOLM },
      { field: "metadata", property: "floor", op: "eq", value: "2" },
    ])
    await page.goto(`/locations?f=${encodeURIComponent(f)}`)
    await expect(nameCells(page)).toHaveText([STOCKHOLM])
    await expect(allChipRemoves(page)).toHaveCount(2)

    const popover = await openFilters(page)
    // The popover opens with the applied conditions.
    await expect(popover.getByRole("group", { name: /^Condition / })).toHaveCount(2)
    await expect(condition(popover, 1).getByLabel("Value", { exact: true })).toHaveValue(STOCKHOLM)
    await expect(condition(popover, 2).getByRole("textbox", { name: "Property" })).toHaveValue("floor")

    const request = net.waitFor("GET", "locations", (c) => filterKeys(c.query).length === 0)
    await popover.getByRole("button", { name: "Clear" }).click()
    await request
    await expect(popover).toBeHidden()
    await expect(allChipRemoves(page)).toHaveCount(0)
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    await expect(page).not.toHaveURL(/[?&]f=/)

    // Reopening starts over with one empty condition.
    const reopened = await openFilters(page)
    await expect(reopened.getByRole("group", { name: /^Condition / })).toHaveCount(1)
    await expect(condition(reopened, 1).getByLabel("Value", { exact: true })).toHaveValue("")
  })

  test("Apply drops incomplete conditions", async ({ page, net, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

    const popover = await openFilters(page)
    await setCondition(ui, condition(popover, 1), { op: "=", value: NEW_YORK })
    await popover.getByRole("button", { name: "Add condition" }).click()
    // No value.
    await setCondition(ui, condition(popover, 2), { field: "Updated" })
    await popover.getByRole("button", { name: "Add condition" }).click()
    // Metadata without a property.
    await setCondition(ui, condition(popover, 3), { field: "Metadata", value: "5" })
    await expect(popover.getByRole("group", { name: /^Condition / })).toHaveCount(3)

    const request = net.waitFor("GET", "locations", (c) => filterKeys(c.query).length > 0)
    await popover.getByRole("button", { name: "Apply" }).click()
    expect(filterKeys((await request).query)).toEqual(["name[eq]"])
    await expect(allChipRemoves(page)).toHaveCount(1)
    await expect.poll(() => JSON.parse(urlParam(page, "f") ?? "[]")).toHaveLength(1)

    const reopened = await openFilters(page)
    await expect(reopened.getByRole("group", { name: /^Condition / })).toHaveCount(1)
  })

  test("applying only incomplete conditions applies nothing", async ({ page, net, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    const popover = await openFilters(page)
    await popover.getByRole("button", { name: "Apply" }).click()
    await expect(popover).toBeHidden()
    await expect(allChipRemoves(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/[?&]f=/)
    await expect(ui.main().getByRole("button", { name: "Reset", exact: true })).toHaveCount(0)
    expect(net.find("GET", "locations").every((c) => filterKeys(c.query).length === 0)).toBe(true)
  })

  test("Add condition and Remove condition edit the draft", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

    const popover = await openFilters(page)
    await setCondition(ui, condition(popover, 1), { value: "first" })
    await popover.getByRole("button", { name: "Add condition" }).click()
    await popover.getByRole("button", { name: "Add condition" }).click()
    await expect(popover.getByRole("group", { name: /^Condition / })).toHaveCount(3)
    await setCondition(ui, condition(popover, 2), { field: "Metadata", property: "floor", value: "second" })

    await popover.getByRole("button", { name: "Remove condition 1" }).click()
    await expect(popover.getByRole("group", { name: /^Condition / })).toHaveCount(2)
    // The second condition moved up and kept its values.
    await expect(condition(popover, 1).getByRole("combobox", { name: "Field" })).toHaveText("Metadata")
    await expect(condition(popover, 1).getByRole("textbox", { name: "Property" })).toHaveValue("floor")
    await expect(condition(popover, 1).getByLabel("Value", { exact: true })).toHaveValue("second")

    await popover.getByRole("button", { name: "Remove condition 2" }).click()
    await popover.getByRole("button", { name: "Remove condition 1" }).click()
    await expect(popover.getByRole("group", { name: /^Condition / })).toHaveCount(0)
    await expect(popover.getByRole("button", { name: "Add condition" })).toBeVisible()
  })

  test("closing the popover without applying discards the draft", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    const popover = await openFilters(page)
    await setCondition(ui, condition(popover, 1), { op: "=", value: STOCKHOLM })
    await page.keyboard.press("Escape")
    await expect(popover).toBeHidden()
    await expect(allChipRemoves(page)).toHaveCount(0)
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

    const reopened = await openFilters(page)
    await expect(condition(reopened, 1).getByLabel("Value", { exact: true })).toHaveValue("")
  })

  test("switching a row's field clears its property and value", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    const popover = await openFilters(page)
    const row = condition(popover, 1)
    await setCondition(ui, row, { field: "Metadata", property: "floor", value: "2" })
    await setCondition(ui, row, { field: "Protected metadata" })
    await expect(row.getByRole("textbox", { name: "Property" })).toHaveValue("")
    await expect(row.getByLabel("Value", { exact: true })).toHaveValue("")
  })

  test(
    "switching a '= (string)' metadata row to Name never sends a string operator",
    async ({ page, net, ui }) => {
      await page.goto("/locations")
      await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])

      const popover = await openFilters(page)
      const row = condition(popover, 1)
      await setCondition(ui, row, { field: "Metadata", op: "= (string)", property: "floor", value: "2" })
      await setCondition(ui, row, { field: "Name", value: STOCKHOLM })

      const request = net.waitFor("GET", "locations", (c) => filterKeys(c.query).some((k) => k.startsWith("name[")))
      await popover.getByRole("button", { name: "Apply" }).click()
      expect(filterKeys((await request).query)).not.toContain("name[seq]")
    }
  )

  test("a filter the API rejects shows the error, and removing its chip recovers", async ({ page, net, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    await net.fail((p) => p === "locations", {
      method: "GET",
      status: 422,
      times: 1,
      body: { message: "The given data was invalid.", errors: { "metadata[floor][gte]": ["Bad filter."] } },
    })
    const popover = await openFilters(page)
    await setCondition(ui, condition(popover, 1), { field: "Metadata", op: "≥", property: "floor", value: "x" })
    await popover.getByRole("button", { name: "Apply" }).click()
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (422)" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("Bad filter.")
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible()

    // The chip stays, so the bad filter can be removed again.
    await chipRemove(page, "Metadata", "≥", "x", "floor").click()
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    await expect(alert).toHaveCount(0)
  })
})

test.describe("locations list: empty states", () => {
  test("filtered: explains that nothing matches", async ({ page, ui }) => {
    await page.goto("/locations?strategy=equalize")
    await expect(ui.main().getByText(EMPTY_FILTERED)).toBeVisible()
    await expect(ui.main().getByText(EMPTY_FIRST)).toHaveCount(0)
    await ui.expectRowCount(0)
  })

  test.describe("with no data", () => {
    test.use({ seed: "empty" })

    test("invites creating the first location", async ({ page, ui }) => {
      await page.goto("/locations")
      await expect(ui.main().getByText(EMPTY_FIRST)).toBeVisible()
      await expect(ui.main().getByText("No locations", { exact: true })).toBeVisible()
      await expect(ui.paginationSummary()).toHaveText("No results")
      await expect(ui.main().getByText("Page 1 of 1")).toBeVisible()
      await expect(ui.main().getByRole("button", { name: "Reset", exact: true })).toHaveCount(0)
      await ui.main().getByRole("button", { name: "New location" }).click()
      await expect(ui.dialog("New location")).toBeVisible()
    })
  })
})

test.describe("locations list: rows", () => {
  test("clicking a row opens the location", async ({ page, api, ui }) => {
    const ny = await api.byName("locations", NEW_YORK)
    await page.goto("/locations")
    await ui.row(NEW_YORK).getByRole("cell", { name: "America/New_York" }).click()
    await expect(page).toHaveURL(new RegExp(`/locations/${ny.id}$`))
    await expect(ui.heading(NEW_YORK)).toBeVisible()
  })

  test("Ctrl/Cmd-click opens the location in a new tab", async ({ page, api, ui, context }) => {
    const ny = await api.byName("locations", NEW_YORK)
    await page.goto("/locations")
    const cell = ui.row(NEW_YORK).getByRole("cell", { name: "America/New_York" })
    await expect(cell).toBeVisible()
    const [tab] = await Promise.all([context.waitForEvent("page"), cell.click({ modifiers: ["ControlOrMeta"] })])
    await expect(tab).toHaveURL(new RegExp(`/locations/${ny.id}$`))
    await tab.close()
    // The list itself stays put.
    await expect(page).toHaveURL(/\/locations$/)
  })

  test("opening the actions menu does not navigate", async ({ page, ui }) => {
    await page.goto("/locations")
    await ui.row(STOCKHOLM).getByRole("button", { name: `Actions for ${STOCKHOLM}` }).click()
    const menu = page.getByRole("menu")
    await expect(menu).toBeVisible()
    await expect(menu.getByRole("menuitem")).toHaveText(["Edit", "Disable", "Delete"])
    await page.keyboard.press("Escape")
    await expect(menu).toBeHidden()
    await expect(page).toHaveURL(/\/locations$/)
  })

  test("Edit opens the edit dialog with the row's values", async ({ page, ui }) => {
    await page.goto("/locations")
    await ui.rowAction(ui.row(NEW_YORK), "Edit")
    const dialog = ui.dialog("Edit location")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(NEW_YORK)
    await expect(dialog.getByRole("combobox", { name: "Time zone" })).toHaveText("America/New_York")
    await expect(dialog.getByRole("radio", { name: /^Randomize/ })).toBeChecked()
    await expect(page).toHaveURL(/\/locations$/)
  })

  test("Delete asks first, then removes the row", async ({ page, api, net, ui }) => {
    const ny = await api.byName("locations", NEW_YORK)
    await page.goto("/locations")
    await ui.rowAction(ui.row(NEW_YORK), "Delete")
    const dialog = ui.alertDialog(`Delete ${NEW_YORK}?`)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("This permanently deletes the location.")

    const request = net.waitFor("DELETE", `locations/${ny.id}`)
    await ui.confirm(`Delete ${NEW_YORK}?`, "Delete location")
    await request
    await expectToast(page, "Location deleted", { type: "success" })
    await expect(nameCells(page)).toHaveText([STOCKHOLM])
    expect((await api.list<LocationJson>("locations")).map((l) => l.name)).toEqual([STOCKHOLM])
  })

  test("Cancel keeps the location", async ({ page, api, net, ui }) => {
    await page.goto("/locations")
    await ui.rowAction(ui.row(NEW_YORK), "Delete")
    await ui.dismiss(`Delete ${NEW_YORK}?`)
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    expect(net.find("DELETE", /^locations\//)).toHaveLength(0)
    expect(await api.list("locations")).toHaveLength(2)
  })

  test("the delete dialog keeps its title while closing", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(ui.row(NEW_YORK)).toBeVisible()
    const flickered = await recordAppearances(page, '[role="alertdialog"]', "Delete location?")
    await ui.rowAction(ui.row(NEW_YORK), "Delete")
    await ui.dismiss(`Delete ${NEW_YORK}?`)
    expect(await flickered()).toBe(false)
  })

  test("a failed delete keeps the dialog open and shows the error", async ({ page, api, net, ui }) => {
    const ny = await api.byName("locations", NEW_YORK)
    await net.fail(`locations/${ny.id}`, { method: "DELETE", status: 500, body: { message: "Server Error" } })
    await page.goto("/locations")
    await ui.rowAction(ui.row(NEW_YORK), "Delete")
    const dialog = ui.alertDialog(`Delete ${NEW_YORK}?`)
    await dialog.getByRole("button", { name: "Delete location" }).click()
    // The alert dialog is modal, so the toast can't be closed until it is dismissed.
    await expectToast(page, "Server Error", { type: "error", close: false })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Delete location" })).toBeEnabled()
    await expect(dialog.getByRole("button", { name: "Delete location" })).not.toHaveAttribute("aria-busy", "true")
    await expectNoToast(page, "Location deleted")

    await ui.dismiss(`Delete ${NEW_YORK}?`)
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    expect(await api.list("locations")).toHaveLength(2)
  })

  test("the confirm button shows progress and Cancel is disabled while deleting", async ({ page, api, net, ui }) => {
    const ny = await api.byName("locations", NEW_YORK)
    await net.delay(`locations/${ny.id}`, 1_000, { method: "DELETE" })
    await page.goto("/locations")
    await ui.rowAction(ui.row(NEW_YORK), "Delete")
    const dialog = ui.alertDialog(`Delete ${NEW_YORK}?`)
    await dialog.getByRole("button", { name: "Delete location" }).click()
    await expect(dialog.getByRole("button", { name: "Delete location" })).toHaveAttribute("aria-busy", "true")
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled()
    // Escape doesn't close it mid-request.
    await page.keyboard.press("Escape")
    await expect(dialog).toBeVisible()
    await expect(dialog).toBeHidden()
    await expectToast(page, "Location deleted")
  })
})

test.describe("locations list: pagination", () => {
  test("pages through 32 locations", async ({ page, api, net, ui }) => {
    await createLocations(api, 30)
    await page.goto("/locations")
    await expect(ui.paginationSummary()).toHaveText("1–25 of 32")
    await ui.expectRowCount(25)
    const first = page.getByRole("button", { name: "First page" })
    const previous = page.getByRole("button", { name: "Previous page" })
    const next = page.getByRole("button", { name: "Next page" })
    const last = page.getByRole("button", { name: "Last page" })
    await expect(ui.main().getByText("Page 1 of 2")).toBeVisible()
    await expect(first).toBeDisabled()
    await expect(previous).toBeDisabled()
    await expect(next).toBeEnabled()
    await expect(last).toBeEnabled()

    const request = net.waitFor("GET", "locations", (c) => c.query.page === "2")
    await next.click()
    expect((await request).query.per_page).toBe("25")
    await expect(ui.paginationSummary()).toHaveText("26–32 of 32")
    await expect(ui.main().getByText("Page 2 of 2")).toBeVisible()
    await expect(page).toHaveURL(/[?&]page=2(&|$)/)
    await ui.expectRowCount(7)
    await expect(nameCells(page).last()).toHaveText("Location 30")
    await expect(first).toBeEnabled()
    await expect(previous).toBeEnabled()
    await expect(next).toBeDisabled()
    await expect(last).toBeDisabled()

    await previous.click()
    await expect(ui.paginationSummary()).toHaveText("1–25 of 32")
    await expect(page).not.toHaveURL(/page=/)

    await last.click()
    await expect(ui.paginationSummary()).toHaveText("26–32 of 32")
    await first.click()
    await expect(ui.paginationSummary()).toHaveText("1–25 of 32")
    await expect(nameCells(page).first()).toHaveText(STOCKHOLM)
  })

  test("rows per page", async ({ page, api, net, ui }) => {
    await createLocations(api, 30)
    await page.goto("/locations?page=2")
    await expect(ui.paginationSummary()).toHaveText("26–32 of 32")
    const perPage = page.getByRole("combobox", { name: "Rows per page" })
    await expect(perPage).toHaveText("25")

    const request = net.waitFor("GET", "locations", (c) => c.query.per_page === "10")
    await ui.choose(perPage, "10")
    // Changing the page size goes back to page 1.
    expect((await request).query.page).toBe("1")
    await expect(ui.paginationSummary()).toHaveText("1–10 of 32")
    await expect(ui.main().getByText("Page 1 of 4")).toBeVisible()
    await expect(page).toHaveURL(/[?&]per_page=10(&|$)/)
    await expect(page).not.toHaveURL(/[?&]page=/)
    await ui.expectRowCount(10)

    await page.getByRole("button", { name: "Last page" }).click()
    await expect(ui.paginationSummary()).toHaveText("31–32 of 32")
    await expect(ui.main().getByText("Page 4 of 4")).toBeVisible()
    await expect(page).toHaveURL(/[?&]page=4(&|$)/)

    // Back to the default size drops the parameter.
    await ui.choose(perPage, "25")
    await expect(page).not.toHaveURL(/per_page=/)
    await expect(ui.paginationSummary()).toHaveText("1–25 of 32")

    await ui.choose(perPage, "50")
    await expect(ui.paginationSummary()).toHaveText("1–32 of 32")
    await expect(ui.main().getByText("Page 1 of 1")).toBeVisible()
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled()
  })

  test("deleting the only row on the last page", async ({ page, api, ui }) => {
    await createLocations(api, 24)
    await page.goto("/locations?page=2")
    await expect(nameCells(page)).toHaveText(["Location 24"])
    await ui.rowAction(ui.row("Location 24"), "Delete")
    await ui.confirm("Delete Location 24?", "Delete location")
    await expectToast(page, "Location deleted")
    await expect(ui.paginationSummary()).toHaveText("1–25 of 25")
  })

  test("deleting the only row on the last page never shows 'create your first'", async ({ page, api, ui }) => {
    await createLocations(api, 24)
    await page.goto("/locations?page=2")
    await expect(nameCells(page)).toHaveText(["Location 24"])
    const appeared = await recordAppearances(page, '[data-slot="empty"]', EMPTY_FIRST)
    await ui.rowAction(ui.row("Location 24"), "Delete")
    await ui.confirm("Delete Location 24?", "Delete location")
    await expectToast(page, "Location deleted")
    await expect(ui.row(STOCKHOLM)).toBeVisible()
    expect(await appeared()).toBe(false)
  })
})

test.describe("locations list: URL state", () => {
  test("a deep link restores sort, page size, filters and chips", async ({ page, api, net, ui }) => {
    await createLocations(api, 3, "Lab")
    const ny = await api.byName("locations", NEW_YORK)
    await api.patch(`locations/${ny.id}`, { enabled: false })
    const f = [{ field: "metadata", property: "floor", op: "gte", value: "1" }]
    const stockholm = await api.byName<LocationJson>("locations", STOCKHOLM)
    for (const lab of await api.list<LocationJson>("locations")) {
      if (lab.name.startsWith("Lab")) await api.patch(`locations/${lab.id}`, { metadata: { floor: 1 } })
    }
    expect(stockholm.metadata).toMatchObject({ floor: 2 })

    const request = net.waitFor("GET", "locations", (c) => c.query.sort === "name.desc")
    await page.goto(
      `/locations?sort=name.desc&per_page=10&strategy=randomize&disabled=exclude&timezone=Europe%2FStockholm&f=${encodeURIComponent(JSON.stringify(f))}`
    )
    await expect(nameCells(page)).toHaveText(["Lab 03", "Lab 02", "Lab 01"])
    expect((await request).query).toEqual({
      page: "1",
      per_page: "10",
      sort: "name.desc",
      disabled: "exclude",
      timezone: "Europe/Stockholm",
      resource_selection_strategy: "randomize",
      "metadata[floor][gte]": "1",
    })
    await expect(page.getByRole("combobox", { name: "Selection strategy" })).toHaveText("Randomize")
    await expect(page.getByRole("combobox", { name: "Filter disabled" })).toHaveText("Hide disabled")
    await expect(page.getByRole("combobox", { name: "Time zone filter" })).toHaveText("Europe/Stockholm")
    await expect(page.getByRole("combobox", { name: "Rows per page" })).toHaveText("10")
    await expect(chipRemove(page, "Metadata", "≥", "1", "floor")).toBeVisible()
    await expect(ui.main().getByRole("button", { name: "Reset", exact: true })).toBeVisible()
  })

  test("survives a reload", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    await ui.choose(page.getByRole("combobox", { name: "Selection strategy" }), "Randomize")
    await sortButton(page, "Name").click()
    await expect(page).toHaveURL(/sort=name\.asc/)
    await expect(page).toHaveURL(/strategy=randomize/)
    await page.reload()
    await expect(nameCells(page)).toHaveText([NEW_YORK])
    await expect(page.getByRole("combobox", { name: "Selection strategy" })).toHaveText("Randomize")
  })

  test("invalid page and page size are clamped", async ({ page, net, ui }) => {
    const request = net.waitFor("GET", "locations")
    await page.goto("/locations?page=0&per_page=500")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    expect((await request).query).toMatchObject({ page: "1", per_page: "100" })
    await expect(page.getByRole("combobox", { name: "Rows per page" })).toHaveText("100")
    await expect(ui.main().getByText("Page 1 of 1")).toBeVisible()
  })

  test("negative and non-numeric values fall back to defaults", async ({ page, net, ui }) => {
    const request = net.waitFor("GET", "locations")
    await page.goto("/locations?page=-3&per_page=abc")
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
    expect((await request).query).toMatchObject({ page: "1", per_page: "25" })
    await expect(ui.paginationSummary()).toHaveText("1–2 of 2")
  })

  test("a page past the end shows the last page", async ({ page, ui }) => {
    await page.goto("/locations?page=5")
    await expect(ui.paginationSummary()).toHaveText(/of 2$/)
    await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
  })

  for (const [label, f] of [
    ["not JSON", "not-json"],
    ["not an array", '{"field":"name"}'],
    ["rows without the required keys", '[{"field":"name"},{"op":"eq"}]'],
  ] as const) {
    test(`a malformed f parameter is ignored (${label})`, async ({ page, net, ui }) => {
      const request = net.waitFor("GET", "locations")
      await page.goto(`/locations?f=${encodeURIComponent(f)}`)
      await expect(nameCells(page)).toHaveText([STOCKHOLM, NEW_YORK])
      expect(filterKeys((await request).query)).toEqual([])
      await expect(allChipRemoves(page)).toHaveCount(0)
      await expect(filtersButton(page)).toHaveText("Filters")
      await expect(ui.main().getByRole("button", { name: "Reset", exact: true })).toHaveCount(0)
    })
  }

  test("an unknown sort value from the URL shows the API error", async ({ page, ui }) => {
    await page.goto("/locations?sort=bogus.asc")
    await expect(ui.main().getByRole("alert").filter({ hasText: "Request failed (422)" })).toBeVisible()
    await expect(ui.main().getByRole("button", { name: "Retry" })).toBeVisible()
  })
})
