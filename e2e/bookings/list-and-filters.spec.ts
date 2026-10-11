import type { Page } from "@playwright/test"

import { NOW_DST_DAY } from "../fixtures/constants"
import type { HapioApi } from "../fixtures/hapio-api"
import { SEED } from "../fixtures/seed"
import { expectAccessible } from "../helpers/a11y"
import { expectToast } from "../helpers/toasts"
import type { Ui } from "../helpers/ui"
import {
  bookingRow,
  bookingRowAction,
  bookingRowActionNames,
  dataRows,
  dateRangeTrigger,
  expect,
  pickDateRange,
  popover,
  seedBooking,
  test,
} from "./_helpers"

const isList = (path: string) => path === "bookings"

test.describe("bookings list", () => {
  test("shows all 13 bookings, including temporary and canceled ones", async ({ page, ui, net, api }) => {
    const request = net.waitFor("GET", isList)
    await page.goto("/bookings")
    const erik = await seedBooking(api, "Erik Lund")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await expect(dataRows(page)).toHaveCount(SEED.bookings.length)
    const call = await request
    expect(call.query).toMatchObject({ temporary: "include", canceled: "include", page: "1", per_page: "25" })
    await expect(ui.paginationSummary()).toHaveText("1–13 of 13")
    await expect(ui.main().getByRole("table").getByText("Temporary")).toHaveCount(2)
    await expect(ui.main().getByRole("table").getByText("Canceled")).toHaveCount(1)
  })

  test("a row shows when, service, resource, location, status and price", async ({ page, api }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    const row = bookingRow(page, erik.id)
    await expect(row).toContainText("Thu 22 Oct 2026")
    await expect(row).toContainText("09:00–09:45")
    await expect(row.getByRole("link", { name: "Haircut" })).toBeVisible()
    await expect(row.getByRole("link", { name: "Anna" })).toBeVisible()
    await expect(row.getByRole("link", { name: "Stockholm Studio" })).toBeVisible()
    await expect(row).toContainText("Confirmed")
    await expect(row).toContainText("450.00")

    const jamie = await seedBooking(api, "Jamie Carter")
    // New York wall time, as the location sees it.
    await expect(bookingRow(page, jamie.id)).toContainText("10:00–10:45")
    await expect(bookingRow(page, jamie.id).getByRole("link", { name: "New York Loft" })).toBeVisible()

    const alva = await seedBooking(api, "Alva Lindqvist")
    await expect(bookingRow(page, alva.id).getByRole("link", { name: alva.booking_group!.id.slice(0, 8) })).toBeVisible()

    const fotostudion = await seedBooking(api, "Fotostudion AB")
    await expect(bookingRow(page, fotostudion.id)).toContainText("09:00 → 27 Oct, 17:00")
  })

  test("canceled rows are muted", async ({ page, api }) => {
    const sara = await seedBooking(api, "Sara Ek")
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, sara.id)).toHaveClass(/text-muted-foreground/)
    await expect(bookingRow(page, sara.id)).toContainText("Canceled")
    await expect(bookingRow(page, erik.id)).not.toHaveClass(/text-muted-foreground/)
  })

  test("clicking a row opens the booking", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await bookingRow(page, erik.id).getByText("Thu 22 Oct 2026").click()
    await expect(page).toHaveURL(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
  })

  test("cell links navigate to their own page, not the booking", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await bookingRow(page, erik.id).getByRole("link", { name: "Anna" }).click()
    await expect(page).toHaveURL(`/resources/${erik.resource!.id}`)
    await expect(ui.heading("Anna")).toBeVisible()

    await page.goBack()
    await bookingRow(page, erik.id).getByRole("link", { name: "Haircut" }).click()
    await expect(page).toHaveURL(`/services/${erik.service!.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
  })

})

test.describe("empty project", () => {
  test.use({ seed: "empty" })

  test("shows a create action", async ({ page, ui }) => {
    await page.goto("/bookings")
    await expect(ui.main().getByText("Create a booking, or book one from a service's bookable slots.")).toBeVisible()
    await expect(ui.main().getByText("No bookings", { exact: true })).toBeVisible()
    await expect(ui.main().getByRole("link", { name: "New booking" })).toHaveCount(2)
    await expect(ui.paginationSummary()).toHaveText("No results")
  })
})

test.describe("date range filter", () => {
  test("starts with any date", async ({ page, api }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: Any date")
  })

  test("Today: nothing today, offers to reset the filters", async ({ page, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    const request = net.waitFor("GET", isList, (c) => !!c.query.from)
    await pickDateRange(page, "Today")
    expect((await request).query).toMatchObject({ from: "2026-10-21T00:00:00+02:00", to: "2026-10-22T00:00:00+02:00" })
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: Today")
    await expect(page.getByText("No bookings match these filters.")).toBeVisible()
    await expect(dataRows(page)).toHaveCount(0)
    await page.getByRole("main").getByRole("button", { name: "Reset filters" }).click()
    await expect(dataRows(page)).toHaveCount(13)
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: Any date")
  })

  test("Next 7 days crosses the DST change", async ({ page, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    const request = net.waitFor("GET", isList, (c) => !!c.query.from)
    await pickDateRange(page, "Next 7 days")
    expect((await request).query).toMatchObject({ from: "2026-10-21T00:00:00+02:00", to: "2026-10-28T00:00:00+01:00" })
    await expect(dataRows(page)).toHaveCount(5)
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: Next 7 days")
    await expect(page).toHaveURL(/from=/)
  })

  test("This month shows every October booking", async ({ page, api }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await pickDateRange(page, "This month")
    const october = SEED.bookings.filter((b) => b.startsAt.startsWith("2026-10"))
    await expect(dataRows(page)).toHaveCount(october.length)
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: This month")
  })

  test("Past 7 days shows the last week's bookings", async ({ page, api }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await pickDateRange(page, "Past 7 days")
    await expect(dataRows(page)).toHaveCount(3)
    for (const customer of ["Oskar Berg", "Lumen Collective", "Sara Ek"]) {
      await expect(bookingRow(page, (await seedBooking(api, customer)).id)).toBeVisible()
    }
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: Past 7 days")
  })

  test("All dates removes the range", async ({ page, api }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await pickDateRange(page, "Next 7 days")
    await expect(dataRows(page)).toHaveCount(5)
    await pickDateRange(page, "All dates")
    await expect(dataRows(page)).toHaveCount(13)
    await expect(page).not.toHaveURL(/from=/)
  })

  test("custom range: ending after and starting before", async ({ page, api, net }) => {
    const nora = await seedBooking(api, "Nora Falk")
    await page.goto("/bookings")
    await expect(bookingRow(page, nora.id)).toBeVisible()
    await dateRangeTrigger(page).click()
    const pop = popover(page)
    await pop.getByLabel("Ending after").fill("2026-10-22T12:00")
    await pop.getByLabel("Starting before").fill("2026-10-23T00:00")
    const request = net.waitFor("GET", isList, (c) => !!c.query.from)
    await pop.getByRole("button", { name: "Apply" }).click()
    await expect(pop).toBeHidden()
    expect((await request).query).toMatchObject({ from: "2026-10-22T12:00:00+02:00", to: "2026-10-23T00:00:00+02:00" })
    await expect(dataRows(page)).toHaveCount(1)
    await expect(bookingRow(page, nora.id)).toBeVisible()
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: 22 Oct 2026, 12:00 – 23 Oct 2026")

    // Reopening shows the applied range.
    await dateRangeTrigger(page).click()
    await expect(pop.getByLabel("Ending after")).toHaveValue("2026-10-22T12:00")
    await expect(pop.getByLabel("Starting before")).toHaveValue("2026-10-23T00:00")
  })

  test("custom range: open-ended either way", async ({ page, api }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    const pop = popover(page)

    await dateRangeTrigger(page).click()
    await pop.getByLabel("Ending after").fill("2026-11-02T00:00")
    await pop.getByRole("button", { name: "Apply" }).click()
    // Leo Wik and the two Lindqvists.
    await expect(dataRows(page)).toHaveCount(3)
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: From 2 Nov 2026")

    await dateRangeTrigger(page).click()
    await pop.getByLabel("Ending after").fill("")
    await pop.getByLabel("Starting before").fill("2026-10-15T00:00")
    await pop.getByRole("button", { name: "Apply" }).click()
    // Maja Holm only.
    await expect(dataRows(page)).toHaveCount(1)
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: Until 15 Oct 2026")
  })

  test("an inverted range shows an error and can't be applied", async ({ page, api }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await dateRangeTrigger(page).click()
    const pop = popover(page)
    await pop.getByLabel("Ending after").fill("2026-10-25T00:00")
    await pop.getByLabel("Starting before").fill("2026-10-22T00:00")
    await expect(pop.getByText("The start of the range must be before its end.")).toBeVisible()
    await expect(pop.getByRole("button", { name: "Apply" })).toBeDisabled()
    await expect(pop.getByLabel("Starting before")).toHaveAttribute("aria-invalid", "true")
    await pop.getByLabel("Starting before").fill("2026-10-26T00:00")
    await expect(pop.getByText("The start of the range must be before its end.")).toBeHidden()
    await expect(pop.getByRole("button", { name: "Apply" })).toBeEnabled()
  })

  test("Clear removes the range; closing discards the draft", async ({ page, api }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await pickDateRange(page, "Next 7 days")
    await expect(dataRows(page)).toHaveCount(5)

    await dateRangeTrigger(page).click()
    const pop = popover(page)
    await pop.getByLabel("Ending after").fill("2026-10-01T00:00")
    await page.keyboard.press("Escape")
    await expect(pop).toBeHidden()
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: Next 7 days")

    await dateRangeTrigger(page).click()
    await expect(pop.getByLabel("Ending after")).toHaveValue("2026-10-21T00:00")
    await pop.getByRole("button", { name: "Clear", exact: true }).click()
    await expect(dataRows(page)).toHaveCount(13)
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: Any date")
  })

  test("with a New York location filter, presets use New York days", async ({ page, api, net, ui }) => {
    const ny = await api.idOf("locations", SEED.locations.newYork.name)
    const jamie = await seedBooking(api, "Jamie Carter")
    await page.goto(`/bookings?location=${ny}`)
    await expect(bookingRow(page, jamie.id)).toBeVisible()
    await expect(dataRows(page)).toHaveCount(1)
    await expect(ui.main().getByRole("combobox", { name: "Location filter" })).toHaveText("New York Loft")

    let request = net.waitFor("GET", isList, (c) => !!c.query.from)
    await pickDateRange(page, "Today")
    expect((await request).query).toMatchObject({
      location: ny,
      from: "2026-10-21T00:00:00-04:00",
      to: "2026-10-22T00:00:00-04:00",
    })
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: Today")

    request = net.waitFor("GET", isList, (c) => c.query.from === "2026-10-01T00:00:00-04:00")
    await pickDateRange(page, "This month")
    expect((await request).query.to).toBe("2026-11-01T00:00:00-04:00")
    await expect(bookingRow(page, jamie.id)).toBeVisible()

    // The inputs edit New York wall time.
    await dateRangeTrigger(page).click()
    await expect(popover(page).getByLabel("Ending after")).toHaveValue("2026-10-01T00:00")
  })
})

test.describe("date range filter on the night the clocks go back", () => {
  test.use({ now: NOW_DST_DAY })

  test("Today is a 25-hour day", async ({ page, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    const request = net.waitFor("GET", isList, (c) => !!c.query.from)
    await pickDateRange(page, "Today")
    expect((await request).query).toMatchObject({ from: "2026-10-25T00:00:00+02:00", to: "2026-10-26T00:00:00+01:00" })
    await expect(dateRangeTrigger(page)).toHaveAccessibleName("Date range: Today")
  })
})

test.describe("entity filters", () => {
  test("location filter, its clear button and the deep link", async ({ page, api, ui, net }) => {
    const sthlm = await api.idOf("locations", SEED.locations.stockholm.name)
    const jamie = await seedBooking(api, "Jamie Carter")
    await page.goto("/bookings")
    await expect(bookingRow(page, jamie.id)).toBeVisible()
    const filter = ui.main().getByRole("combobox", { name: "Location filter" })
    const request = net.waitFor("GET", isList, (c) => c.query.location === sthlm)
    await ui.pick(filter, "Stockholm Studio")
    await request
    await expect(dataRows(page)).toHaveCount(12)
    await expect(bookingRow(page, jamie.id)).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`location=${sthlm}`))

    await ui.main().getByRole("button", { name: "Clear location filter" }).click()
    await expect(dataRows(page)).toHaveCount(13)
    await expect(filter).toHaveText("Any location")

    await page.goto(`/bookings?location=${sthlm}`)
    await expect(filter).toHaveText("Stockholm Studio")
    await expect(dataRows(page)).toHaveCount(12)
  })

  test("resource filter", async ({ page, api, ui }) => {
    const ben = await api.idOf("resources", "Ben")
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await ui.pick(ui.main().getByRole("combobox", { name: "Resource filter" }), "Ben")
    await expect(dataRows(page)).toHaveCount(SEED.bookings.filter((b) => b.resource === "Ben").length)
    await expect(page).toHaveURL(new RegExp(`resource=${ben}`))
    await ui.main().getByRole("button", { name: "Clear resource filter" }).click()
    await expect(dataRows(page)).toHaveCount(13)
  })

  test("service filter", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await ui.pick(ui.main().getByRole("combobox", { name: "Service filter" }), "Studio rental")
    await expect(dataRows(page)).toHaveCount(2)
    await expect(bookingRow(page, erik.id)).toBeHidden()
    await ui.main().getByRole("button", { name: "Clear service filter" }).click()
    await expect(dataRows(page)).toHaveCount(13)
  })

  test("filters combine", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await ui.pick(ui.main().getByRole("combobox", { name: "Resource filter" }), "Anna")
    await ui.pick(ui.main().getByRole("combobox", { name: "Location filter" }), "New York Loft")
    await expect(dataRows(page)).toHaveCount(1)
    await expect(bookingRow(page, (await seedBooking(api, "Jamie Carter")).id)).toBeVisible()
  })
})

test.describe("status filters", () => {
  test("only temporary", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    const request = net.waitFor("GET", isList, (c) => c.query.temporary === "only")
    await ui.choose(ui.main().getByRole("combobox", { name: "Filter temporary" }), "Only temporary")
    await request
    await expect(dataRows(page)).toHaveCount(2)
    await expect(bookingRow(page, (await seedBooking(api, "Ida Strand")).id)).toBeVisible()
    await expect(bookingRow(page, (await seedBooking(api, "Leo Wik")).id)).toBeVisible()
    await expect(page).toHaveURL(/temporary=only/)
  })

  test("hide canceled", async ({ page, api, ui }) => {
    const sara = await seedBooking(api, "Sara Ek")
    await page.goto("/bookings")
    await expect(bookingRow(page, sara.id)).toBeVisible()
    await ui.choose(ui.main().getByRole("combobox", { name: "Filter canceled" }), "Hide canceled")
    await expect(dataRows(page)).toHaveCount(12)
    await expect(bookingRow(page, sara.id)).toBeHidden()
  })

  test("only canceled", async ({ page, api, ui }) => {
    const sara = await seedBooking(api, "Sara Ek")
    await page.goto("/bookings?canceled=only")
    await expect(bookingRow(page, sara.id)).toBeVisible()
    await expect(dataRows(page)).toHaveCount(1)
    await expect(ui.main().getByRole("combobox", { name: "Filter canceled" })).toHaveText("Only canceled")
  })
})

test.describe("advanced filters", () => {
  test("metadata customer->name = (string) Erik Lund", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await ui.main().getByRole("button", { name: /^Filters/ }).click()
    const condition = page.getByRole("group", { name: "Condition 1" })
    await ui.choose(condition.getByRole("combobox", { name: "Field" }), "Metadata")
    await ui.choose(condition.getByRole("combobox", { name: "Operator" }), "= (string)")
    await condition.getByRole("textbox", { name: "Property" }).fill("customer->name")
    await condition.getByRole("textbox", { name: "Value" }).fill("Erik Lund")
    const request = net.waitFor("GET", isList, (c) => "metadata[customer->name][seq]" in c.query)
    await popover(page).getByRole("button", { name: "Apply" }).click()
    expect((await request).query["metadata[customer->name][seq]"]).toBe("Erik Lund")
    await expect(dataRows(page)).toHaveCount(1)
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await expect(ui.main().getByRole("button", { name: /^Filters/ })).toContainText("1")

    await ui.main().getByRole("button", { name: "Remove filter: Metadata customer->name = (string) Erik Lund" }).click()
    await expect(dataRows(page)).toHaveCount(13)
  })

  test("price ≥ 400", async ({ page, api, ui, net }) => {
    const fotostudion = await seedBooking(api, "Fotostudion AB")
    await page.goto("/bookings")
    await expect(bookingRow(page, fotostudion.id)).toBeVisible()
    await ui.main().getByRole("button", { name: /^Filters/ }).click()
    const condition = page.getByRole("group", { name: "Condition 1" })
    await ui.choose(condition.getByRole("combobox", { name: "Field" }), "Price")
    await expect(condition.getByRole("combobox", { name: "Operator" })).toHaveText("≥")
    await condition.getByRole("textbox", { name: "Value" }).fill("400")
    const request = net.waitFor("GET", isList, (c) => "price[gte]" in c.query)
    await popover(page).getByRole("button", { name: "Apply" }).click()
    expect((await request).query["price[gte]"]).toMatch(/^400(\.000)?$/)
    // Everything but the 300.000 equipment rental.
    await expect(dataRows(page)).toHaveCount(12)
    await expect(bookingRow(page, fotostudion.id)).toBeHidden()
  })
})

test.describe("advanced filters: switching fields", () => {
  test("switching a metadata row to Price drops the string-only operator", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await ui.main().getByRole("button", { name: /^Filters/ }).click()
    const condition = page.getByRole("group", { name: "Condition 1" })
    await ui.choose(condition.getByRole("combobox", { name: "Field" }), "Metadata")
    await ui.choose(condition.getByRole("combobox", { name: "Operator" }), "= (string)")
    await ui.choose(condition.getByRole("combobox", { name: "Field" }), "Price")
    await condition.getByRole("textbox", { name: "Value" }).fill("450")
    const request = net.waitFor("GET", isList, (c) => Object.keys(c.query).some((k) => k.startsWith("price[")))
    await popover(page).getByRole("button", { name: "Apply" }).click()
    expect(Object.keys((await request).query).filter((k) => k.startsWith("price["))).not.toContain("price[seq]")
  })
})

test.describe("sorting, reset and paging", () => {
  test("sort select", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    const request = net.waitFor("GET", isList, (c) => c.query.sort === "starts_at.desc")
    await ui.choose(ui.main().getByRole("combobox", { name: "Sort" }), "Start ↓")
    await request
    await expect(dataRows(page).first()).toContainText("Tue 3 Nov 2026")
    await expect(dataRows(page).last()).toContainText("Wed 14 Oct 2026")
    await expect(page).toHaveURL(/sort=starts_at\.desc/)
  })

  test("header sort cycles ascending, descending, default", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    const when = ui.main().getByRole("button", { name: "When", exact: true })

    let request = net.waitFor("GET", isList, (c) => c.query.sort === "starts_at.asc")
    await when.click()
    await request
    await expect(page).toHaveURL(/sort=starts_at\.asc/)
    await expect(dataRows(page).first()).toContainText("Wed 14 Oct 2026")
    await expect(ui.main().getByRole("combobox", { name: "Sort" })).toContainText("Start ↑")

    request = net.waitFor("GET", isList, (c) => c.query.sort === "starts_at.desc")
    await when.click()
    await request
    await expect(dataRows(page).first()).toContainText("Tue 3 Nov 2026")

    await when.click()
    await expect(page).not.toHaveURL(/sort=/)
    await expect(ui.main().getByRole("combobox", { name: "Sort" })).toContainText("Default order")
  })

  test("Reset clears every filter", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings?canceled=exclude&temporary=only")
    await expect(dataRows(page)).toHaveCount(2)
    await ui.pick(ui.main().getByRole("combobox", { name: "Resource filter" }), "Anna")
    await expect(dataRows(page)).toHaveCount(1)
    await ui.main().getByRole("button", { name: "Reset", exact: true }).click()
    await expect(dataRows(page)).toHaveCount(13)
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await expect(ui.main().getByRole("button", { name: "Reset", exact: true })).toBeHidden()
    await expect(page).not.toHaveURL(/canceled=|temporary=|resource=/)
  })

  test("changing a filter goes back to the first page", async ({ page, ui, net }) => {
    await page.goto("/bookings?per_page=10&page=2")
    await expect(ui.paginationSummary()).toHaveText("11–13 of 13")
    await expect(dataRows(page)).toHaveCount(3)
    const request = net.waitFor("GET", isList, (c) => c.query.canceled === "exclude")
    await ui.choose(ui.main().getByRole("combobox", { name: "Filter canceled" }), "Hide canceled")
    expect((await request).query.page).toBe("1")
    await expect(ui.paginationSummary()).toHaveText("1–10 of 12")
    await expect(page).not.toHaveURL(/page=2/)
  })
})

test.describe("row actions", () => {
  test("View opens the booking", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await bookingRowAction(page, erik.id, "View")
    await expect(page).toHaveURL(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
  })

  test("Edit opens the edit dialog", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await bookingRowAction(page, erik.id, "Edit")
    const dialog = ui.dialog("Edit booking")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-22T09:00")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
  })

  test("menus offer Finalize only for temporary bookings, Restore only for canceled ones", async ({ page, api }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const ida = await seedBooking(api, "Ida Strand")
    const sara = await seedBooking(api, "Sara Ek")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    expect(await bookingRowActionNames(page, erik.id)).toEqual(["View", "Edit", "Cancel booking", "Delete"])
    expect(await bookingRowActionNames(page, ida.id)).toEqual(["View", "Edit", "Finalize", "Cancel booking", "Delete"])
    expect(await bookingRowActionNames(page, sara.id)).toEqual(["View", "Edit", "Restore", "Delete"])
  })

  test("Finalize", async ({ page, api, net }) => {
    const ida = await seedBooking(api, "Ida Strand")
    await page.goto("/bookings")
    await expect(bookingRow(page, ida.id)).toContainText("Temporary")
    const request = net.waitFor("PATCH", `bookings/${ida.id}`)
    await bookingRowAction(page, ida.id, "Finalize")
    expect((await request).body).toEqual({ is_temporary: false })
    await expectToast(page, "Booking finalized", { type: "success" })
    await expect(bookingRow(page, ida.id)).toContainText("Confirmed")
    expect((await api.get(`bookings/${ida.id}`)).is_temporary).toBe(false)
  })

  test("Cancel booking: Keep booking sends nothing", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await bookingRowAction(page, erik.id, "Cancel booking")
    const dialog = ui.alertDialog("Cancel this booking?")
    await expect(dialog).toContainText("Haircut, Thu 22 Oct 2026, 09:00–09:45.")
    await dialog.getByRole("button", { name: "Keep booking" }).click()
    await expect(dialog).toBeHidden()
    expect(net.mutations()).toEqual([])
  })

  test("Cancel booking", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await bookingRowAction(page, erik.id, "Cancel booking")
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await ui.confirm("Cancel this booking?", "Cancel booking")
    expect((await request).body).toEqual({ is_canceled: true })
    await expectToast(page, "Booking canceled", { type: "success" })
    await expect(bookingRow(page, erik.id)).toContainText("Canceled")
    await expect(bookingRow(page, erik.id)).toHaveClass(/text-muted-foreground/)
  })

  test("Cancel booking past the threshold: the error toasts and the dialog stays", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const message = "The cancelation threshold for this booking has passed."
    await net.fail(`bookings/${erik.id}`, {
      method: "PATCH",
      status: 422,
      body: { message, errors: { is_canceled: [message] } },
      times: 1,
    })
    await page.goto("/bookings")
    await bookingRowAction(page, erik.id, "Cancel booking")
    const dialog = ui.alertDialog("Cancel this booking?")
    await dialog.getByRole("button", { name: "Cancel booking" }).click()
    // The toast sits under the modal's overlay; it is closed once the dialog is gone.
    await expectToast(page, message, { type: "error", close: false })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Cancel booking" })).toBeEnabled()

    // Retry, bypassing the threshold.
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await dialog.getByRole("checkbox", { name: "Ignore cancelation threshold" }).check()
    await dialog.getByRole("button", { name: "Cancel booking" }).click()
    expect((await request).body).toEqual({ is_canceled: true, ignore_cancelation_threshold: true })
    await expect(dialog).toBeHidden()
    await expectToast(page, "Booking canceled")
  })

  test("Restore", async ({ page, api, net }) => {
    const sara = await seedBooking(api, "Sara Ek")
    await page.goto("/bookings")
    await expect(bookingRow(page, sara.id)).toContainText("Canceled")
    const request = net.waitFor("PATCH", `bookings/${sara.id}`)
    await bookingRowAction(page, sara.id, "Restore")
    expect((await request).body).toEqual({ is_canceled: false })
    await expectToast(page, "Booking restored", { type: "success" })
    await expect(bookingRow(page, sara.id)).toContainText("Confirmed")
  })

  test("Delete asks first", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await bookingRowAction(page, erik.id, "Delete")
    const dialog = ui.alertDialog("Delete this booking permanently?")
    await expect(dialog).toContainText(
      "Haircut, Thu 22 Oct 2026, 09:00–09:45. This can't be undone. To free up the time but keep a record, cancel the booking instead."
    )
    await ui.dismiss("Delete this booking permanently?")
    expect(net.mutations()).toEqual([])

    await bookingRowAction(page, erik.id, "Delete")
    const request = net.waitFor("DELETE", `bookings/${erik.id}`)
    await ui.confirm("Delete this booking permanently?", "Delete booking")
    await request
    await expectToast(page, "Booking deleted", { type: "success" })
    await expect(dataRows(page)).toHaveCount(12)
    await expect(bookingRow(page, erik.id)).toBeHidden()
    await expect(api.get(`bookings/${erik.id}`)).rejects.toMatchObject({ status: 404 })
  })

  test("a failing list shows an error with retry", async ({ page, ui, net, consoleGuard }) => {
    consoleGuard.allow(/500/)
    await net.fail(isList, { method: "GET", status: 500, body: { message: "Hapio is down" }, times: 2 })
    await page.goto("/bookings")
    await expect(ui.main().getByText("Request failed (500)")).toBeVisible({ timeout: 10_000 })
    await expect(ui.main().getByText("Hapio is down")).toBeVisible()
    await ui.main().getByRole("button", { name: "Retry" }).click()
    await expect(dataRows(page)).toHaveCount(13)
  })
})

test.describe("paging after a delete", () => {
  test("deleting the only row on the last page goes back a page", async ({ page, api, ui }) => {
    // 11 bookings at 10 per page: page 2 holds only Elias Lindqvist.
    for (const customer of ["Maja Holm", "Oskar Berg"]) await api.delete(`bookings/${(await seedBooking(api, customer)).id}`)
    const elias = await seedBooking(api, "Elias Lindqvist")
    await page.goto("/bookings?per_page=10&page=2")
    await expect(bookingRow(page, elias.id)).toBeVisible()
    await expect(ui.paginationSummary()).toHaveText("11–11 of 11")
    await bookingRowAction(page, elias.id, "Delete")
    await ui.confirm("Delete this booking permanently?", "Delete booking")
    await expectToast(page, "Booking deleted")
    await expect(ui.paginationSummary()).toHaveText("1–10 of 10")
    await expect(dataRows(page)).toHaveCount(10)
  })
})

test.describe("accessibility", () => {
  /** The list, then the advanced filters popover. */
  async function sweep(page: Page, api: HapioApi, ui: Ui, check: (include: string) => Promise<void>) {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await expect(bookingRow(page, erik.id)).toBeVisible()
    await check("main")
    await ui.main().getByRole("button", { name: /^Filters/ }).click()
    await expect(page.getByRole("group", { name: "Condition 1" })).toBeVisible()
    await check('[data-slot="popover-content"]')
  }

  test("the bookings list has no serious violations", async ({ page, api, ui }) => {
    await sweep(page, api, ui, (include) => expectAccessible(page, { include }))
  })
})
