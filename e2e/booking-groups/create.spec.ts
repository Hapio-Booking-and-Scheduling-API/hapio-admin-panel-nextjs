import type { Locator, Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import type { Ui } from "../helpers/ui"
import { expectToast } from "../helpers/toasts"
import { allowDateSubclasses, bookingRow, expectHydrated, getGroup, rowFields, seedIds, short } from "./_helpers"

const STHLM = SEED.locations.stockholm.name
const NY = SEED.locations.newYork.name

interface RowInput {
  service?: string
  location?: string
  resource?: string
  starts?: string
  ends?: string
  price?: string
}

/** Fills a booking row. Location first, so times are entered in its zone. */
async function fillRow(ui: Ui, row: Locator, input: RowInput) {
  const f = rowFields(row)
  if (input.location) await ui.pick(f.location, input.location)
  if (input.service) await ui.pick(f.service, input.service)
  if (input.resource) await ui.pick(f.resource, input.resource)
  if (input.starts) await f.starts.fill(input.starts)
  if (input.ends) await f.ends.fill(input.ends)
  if (input.price !== undefined) {
    await f.price.fill(input.price)
    await f.price.blur()
  }
}

async function openForm(page: Page) {
  await page.goto("/booking-groups/new")
  await expectHydrated(page)
  await expect(bookingRow(page, 1)).toBeVisible()
}

/** Two valid Haircut rows at Stockholm Studio on Thu 5 Nov. */
async function fillTwoRows(page: Page, ui: Ui) {
  await fillRow(ui, bookingRow(page, 1), { service: "Haircut", location: STHLM, starts: "2026-11-05T10:00" })
  await page.getByRole("button", { name: "Add booking" }).click()
  await fillRow(ui, bookingRow(page, 2), { resource: "Ben", starts: "2026-11-05T11:00" })
}

const submit = (page: Page) => page.getByRole("button", { name: "Create booking group" })
const formAlert = (page: Page) => page.getByRole("alert").filter({ hasText: "Hapio rejected the request" })
const toasts = (page: Page) => page.locator("[data-sonner-toast]")

test.describe("new booking group", () => {
  test("starts with one new, empty booking row", async ({ page, ui }) => {
    await openForm(page)
    const row = bookingRow(page, 1)
    const f = rowFields(row)

    await expect(page.getByRole("group", { name: /^Booking \d+$/ })).toHaveCount(1)
    await expect(row.getByText("New", { exact: true })).toBeVisible()
    await expect(row.getByRole("button", { name: "Remove booking 1" })).toBeDisabled()
    await expect(f.service).toHaveText("Select service…")
    await expect(f.location).toHaveText("Select location…")
    await expect(f.resource).toHaveText("Auto-select")
    await expect(f.starts).toHaveValue("")
    await expect(f.ends).toHaveValue("")
    await expect(f.price).toHaveAttribute("placeholder", "Calculated by Hapio")
    await expect(f.temporary).not.toBeChecked()
    await expect(f.temporary).toBeEnabled()
    await expect(f.canceled).toHaveCount(0)
    await expect(row.getByRole("link", { name: /Open/ })).toHaveCount(0)
    await expect(ui.main().getByText("Times are entered in each location's time zone.", { exact: false })).toBeVisible()
  })

  test("Add booking copies service, location, resource and Temporary from the last row", async ({ page, ui }) => {
    await openForm(page)
    await fillRow(ui, bookingRow(page, 1), {
      location: NY,
      service: "Studio rental",
      resource: "Room A",
      starts: "2026-11-05T10:00",
      price: "99",
    })
    await rowFields(bookingRow(page, 1)).temporary.click()

    await page.getByRole("button", { name: "Add booking" }).click()
    const second = bookingRow(page, 2)
    const f = rowFields(second)
    await expect(second.getByText("New", { exact: true })).toBeVisible()
    await expect(f.service).toHaveText("Studio rental")
    await expect(f.location).toHaveText(NY)
    await expect(f.resource).toHaveText("Room A")
    await expect(f.temporary).toBeChecked()
    await expect(f.starts).toHaveValue("")
    await expect(f.ends).toHaveValue("")
    await expect(f.price).toHaveValue("")

    await expect(page.getByRole("button", { name: "Remove booking 1" })).toBeEnabled()
    await page.getByRole("button", { name: "Remove booking 2" }).click()
    await expect(second).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Remove booking 1" })).toBeDisabled()
    // The first row is untouched.
    await expect(rowFields(bookingRow(page, 1)).price).toHaveValue("99.000")
  })

  test("validates every row before sending", async ({ page, ui, net }) => {
    await openForm(page)
    await submit(page).click()

    const first = bookingRow(page, 1)
    await expect(first.getByText("Select a service")).toBeVisible()
    await expect(first.getByText("Select a location")).toBeVisible()
    await expect(first.getByText("Required", { exact: true })).toHaveCount(2)

    await fillRow(ui, first, { service: "Haircut", location: STHLM, starts: "2026-11-05T10:00", price: "12.3456" })
    await expect(first.getByText("Select a service")).toBeHidden()
    await expect(first.getByText("Use a number with up to 12 digits and 3 decimals, e.g. 149.000")).toBeVisible()
    await rowFields(first).price.fill("")

    await page.getByRole("button", { name: "Add booking" }).click()
    const second = bookingRow(page, 2)
    await fillRow(ui, second, { starts: "2026-11-05T12:00", ends: "2026-11-05T11:00" })
    await submit(page).click()
    await expect(second.getByText("Must be after the start")).toBeVisible()
    await expect(first.getByRole("alert")).toHaveCount(0)
    expect(net.find("POST", "booking-groups")).toEqual([])
  })

  test("fills the end from the service's duration and keeps the length when the start moves", async ({ page, ui }) => {
    await openForm(page)
    const row = bookingRow(page, 1)
    const f = rowFields(row)

    // Start first, then the service: the end is filled in.
    await fillRow(ui, row, { location: STHLM, starts: "2026-11-05T10:00" })
    await expect(f.ends).toHaveValue("")
    await ui.pick(f.service, "Haircut")
    await expect(f.ends).toHaveValue("2026-11-05T10:45")

    await f.starts.fill("2026-11-05T13:30")
    await expect(f.ends).toHaveValue("2026-11-05T14:15")
    await f.ends.fill("2026-11-05T15:30")
    await f.starts.fill("2026-11-05T14:00")
    await expect(f.ends).toHaveValue("2026-11-05T16:00")

    // A flexible service without a default length uses its minimum.
    await page.getByRole("button", { name: "Add booking" }).click()
    const second = rowFields(bookingRow(page, 2))
    await ui.pick(second.service, "Studio rental")
    await second.starts.fill("2026-11-06T09:00")
    await expect(second.ends).toHaveValue("2026-11-06T10:00")
  })

  test("changing the location keeps the wall time in the new zone", async ({ page, ui, api, net }) => {
    const ids = await seedIds(api)
    await allowDateSubclasses(page)
    await openForm(page)
    const row = bookingRow(page, 1)
    const f = rowFields(row)

    await fillRow(ui, row, { location: STHLM, starts: "2026-11-05T10:00", ends: "2026-11-05T11:00" })
    await expect(row.getByText("Europe/Stockholm", { exact: true })).toHaveCount(2)
    await ui.pick(f.location, NY)
    await expect(row.getByText("America/New_York", { exact: true })).toHaveCount(2)
    await expect(f.starts).toHaveValue("2026-11-05T10:00")
    await expect(f.ends).toHaveValue("2026-11-05T11:00")
    await ui.pick(f.service, "Haircut")
    // Picking the service doesn't touch an end that is already set.
    await expect(f.ends).toHaveValue("2026-11-05T11:00")

    const request = net.waitFor("POST", "booking-groups")
    await submit(page).click()
    // US daylight saving time ended on 1 Nov.
    expect((await request).body).toEqual({
      bookings: [
        {
          service_id: ids.haircut,
          location_id: ids.newYork,
          starts_at: "2026-11-05T10:00:00-05:00",
          ends_at: "2026-11-05T11:00:00-05:00",
        },
      ],
    })
    await expectToast(page, "Booking group created")
  })

  test("an empty price and resource are left for Hapio to fill in", async ({ page, ui, api, net }) => {
    await openForm(page)
    await fillRow(ui, bookingRow(page, 1), { service: "Haircut", location: STHLM, starts: "2026-11-05T10:00" })

    const request = net.waitFor("POST", "booking-groups")
    await submit(page).click()
    const sent = (await request).body as { bookings: Record<string, unknown>[] }
    expect(sent.bookings[0]).not.toHaveProperty("price")
    expect(sent.bookings[0]).not.toHaveProperty("resource_id")
    await expectToast(page, "Booking group created")

    await expect(page).toHaveURL(/\/booking-groups\/[0-9a-f-]{36}$/)
    const created = await getGroup(api, page.url().split("/").pop()!)
    expect(created.bookings).toHaveLength(1)
    expect(created.bookings[0].price).toBe(SEED.services.haircut.price)
    // Stockholm Studio prioritises Anna.
    expect(created.bookings[0].resource?.name).toBe(SEED.priority[0])
  })

  test("sends the exact body and opens the new group", async ({ page, ui, api, net }) => {
    const ids = await seedIds(api)
    await openForm(page)
    await fillRow(ui, bookingRow(page, 1), {
      service: "Haircut",
      location: STHLM,
      resource: "Anna",
      starts: "2026-11-05T10:00",
    })
    await page.getByRole("button", { name: "Add booking" }).click()
    await fillRow(ui, bookingRow(page, 2), { starts: "2026-11-05T11:00", price: "500" })
    await expect(rowFields(bookingRow(page, 2)).price).toHaveValue("500.000")
    await page.getByRole("textbox", { name: "Metadata", exact: true }).fill('{"party":"Holm"}')

    await net.delay("booking-groups", 600, { method: "POST" })
    const request = net.waitFor("POST", "booking-groups")
    await submit(page).click()
    await expect(submit(page)).toHaveAttribute("aria-busy", "true")
    await expect(submit(page)).toBeDisabled()
    expect((await request).body).toEqual({
      bookings: [
        {
          service_id: ids.haircut,
          location_id: ids.stockholm,
          resource_id: ids.anna,
          starts_at: "2026-11-05T10:00:00+01:00",
          ends_at: "2026-11-05T10:45:00+01:00",
        },
        {
          service_id: ids.haircut,
          location_id: ids.stockholm,
          resource_id: ids.anna,
          starts_at: "2026-11-05T11:00:00+01:00",
          ends_at: "2026-11-05T11:45:00+01:00",
          price: "500.000",
        },
      ],
      metadata: { party: "Holm" },
    })

    await expectToast(page, "Booking group created", { type: "success" })
    await expect(page).toHaveURL(/\/booking-groups\/[0-9a-f-]{36}$/)
    const id = page.url().split("/").pop()!
    await expect(ui.heading(`Booking group ${short(id)}`)).toBeVisible()
    await expect(ui.main().getByText("2 bookings", { exact: true })).toBeVisible()

    const created = await getGroup(api, id)
    expect(created.metadata).toEqual({ party: "Holm" })
    expect(created.bookings.map((b) => [b.resource?.name, b.price])).toEqual([
      ["Anna", "450.000"],
      ["Anna", "500.000"],
    ])
    expect(await api.list("booking-groups")).toHaveLength(2)
  })

  test("going back after creating a group offers a fresh, usable form", async ({ page, ui, net }) => {
    await openForm(page)
    await fillTwoRows(page, ui)
    await page.getByRole("textbox", { name: "Metadata", exact: true }).fill('{"party":"Holm"}')
    await submit(page).click()
    await expectToast(page, "Booking group created")
    await expect(page).toHaveURL(/\/booking-groups\/[0-9a-f-]{36}$/)
    await expect(ui.heading(/^Booking group /)).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL("/booking-groups/new")
    await expect(ui.heading("New booking group")).toBeVisible()
    await expect(submit(page)).toBeEnabled()
    await expect(submit(page)).not.toHaveAttribute("aria-busy", "true")
    await expect(page.getByRole("group", { name: /^Booking \d+$/ })).toHaveCount(1)
    await expect(rowFields(bookingRow(page, 1)).starts).toHaveValue("")
    await expect(page.getByRole("textbox", { name: "Metadata", exact: true })).toHaveValue("")

    // And it creates another group.
    await fillRow(ui, bookingRow(page, 1), { service: "Haircut", location: STHLM, starts: "2026-11-06T10:00" })
    const request = net.waitFor("POST", "booking-groups")
    await submit(page).click()
    expect(((await request).body as { bookings: unknown[] }).bookings).toHaveLength(1)
    await expectToast(page, "Booking group created")
  })

  test("a draft that wasn't sent survives leaving and coming back", async ({ page, ui }) => {
    await openForm(page)
    await fillRow(ui, bookingRow(page, 1), { service: "Haircut", location: STHLM, starts: "2026-11-05T10:00" })
    await page.getByRole("link", { name: "Cancel" }).click()
    await expect(ui.row("2 confirmed")).toBeVisible()

    await page.goBack()
    await expect(ui.heading("New booking group")).toBeVisible()
    await expect(rowFields(bookingRow(page, 1)).starts).toHaveValue("2026-11-05T10:00")
    await expect(submit(page)).toBeEnabled()
  })

  test("validates and sends the group metadata", async ({ page, ui, net }) => {
    await openForm(page)
    await fillRow(ui, bookingRow(page, 1), { service: "Haircut", location: STHLM, starts: "2026-11-05T10:00" })
    const metadata = page.getByRole("textbox", { name: "Metadata", exact: true })
    const protectedMetadata = page.getByRole("textbox", { name: "Protected metadata", exact: true })

    await metadata.fill("[1, 2]")
    await submit(page).click()
    await expect(page.getByRole("alert").filter({ hasText: "Metadata must be a JSON object." })).toBeVisible()
    expect(net.find("POST", "booking-groups")).toEqual([])

    await metadata.fill('{"party":"Holm"}')
    await protectedMetadata.fill('{"vip":true}')
    const request = net.waitFor("POST", "booking-groups")
    await submit(page).click()
    expect((await request).body).toMatchObject({ metadata: { party: "Holm" }, protected_metadata: { vip: true } })
    await expectToast(page, "Booking group created")
  })

  test("override rules apply to every booking and have no cancelation flag", async ({ page, ui, net }) => {
    await openForm(page)
    const trigger = page.getByRole("button", { name: /^Override rules/ })
    await trigger.click()
    for (const name of ["Ignore schedule", "Ignore fully booked", "Ignore bookable slots", "Ignore booking window"]) {
      await expect(page.getByRole("switch", { name, exact: true })).not.toBeChecked()
    }
    await expect(page.getByRole("switch", { name: "Ignore cancelation threshold" })).toHaveCount(0)

    await page.getByRole("switch", { name: "Ignore schedule", exact: true }).click()
    await page.getByRole("switch", { name: "Ignore booking window", exact: true }).click()
    // Ignoring the schedule implies ignoring bookable slots.
    const slots = page.getByRole("switch", { name: "Ignore bookable slots", exact: true })
    await expect(slots).toBeChecked()
    await expect(slots).toBeDisabled()
    await expect(trigger).toContainText("2 on")

    await fillTwoRows(page, ui)
    const request = net.waitFor("POST", "booking-groups")
    await submit(page).click()
    const sent = (await request).body as { bookings: Record<string, unknown>[] }
    expect(sent.bookings).toHaveLength(2)
    for (const booking of sent.bookings) {
      expect(booking).toMatchObject({ ignore_schedule: true, ignore_booking_window: true })
      expect(booking).not.toHaveProperty("ignore_bookable_slots")
      expect(booking).not.toHaveProperty("ignore_fully_booked")
      expect(booking).not.toHaveProperty("ignore_cancelation_threshold")
    }
    await expectToast(page, "Booking group created")
  })

  test("Hapio's per-booking errors show on the rejected row, without a toast", async ({ page, ui, net }) => {
    await openForm(page)
    await fillTwoRows(page, ui)
    await net.fail("booking-groups", {
      method: "POST",
      status: 422,
      body: {
        message: "The given data was invalid.",
        errors: { "bookings.1.starts_at": ["The starts at must be within opening hours."] },
        messages: { "bookings.1": "Ben is fully booked at this time." },
      },
    })
    await submit(page).click()

    const second = bookingRow(page, 2)
    await expect(second.getByText("The starts at must be within opening hours.")).toBeVisible()
    await expect(rowFields(second).starts).toHaveAttribute("aria-invalid", "true")
    await expect(rowFields(second).alert).toContainText("Ben is fully booked at this time.")
    await expect(bookingRow(page, 1).getByRole("alert")).toHaveCount(0)
    await expect(formAlert(page)).toContainText("Hapio rejected booking 2. See the details on that row.")
    await expect(page).toHaveURL("/booking-groups/new")
    await expect(submit(page)).toBeEnabled()
    await expect(toasts(page)).toHaveCount(0)
  })

  test("a message repeated for the field and the row shows once", async ({ page, ui, net }) => {
    await openForm(page)
    await fillTwoRows(page, ui)
    const message = "The starts at must be within opening hours."
    await net.fail("booking-groups", {
      method: "POST",
      status: 422,
      body: {
        message: "The given data was invalid.",
        errors: { "bookings.1.starts_at": [message] },
        messages: { "bookings.1": message },
      },
    })
    await submit(page).click()
    const second = bookingRow(page, 2)
    await expect(rowFields(second).starts).toHaveAttribute("aria-invalid", "true")
    await expect(second.getByText(message)).toHaveCount(1)
    await expect(second.getByText(message)).toBeVisible()
    // Nothing else to say on the row, so no row alert; the form still points at the row.
    await expect(rowFields(second).alert).toHaveCount(0)
    await expect(formAlert(page)).toContainText("Hapio rejected booking 2. See the details on that row.")
  })

  test("adding or removing a row clears the stale row alerts", async ({ page, ui, net }) => {
    await openForm(page)
    await fillTwoRows(page, ui)
    await net.fail("booking-groups", {
      method: "POST",
      status: 422,
      body: { message: "The given data was invalid.", messages: { "bookings.1": "Ben is fully booked at this time." } },
      times: 2,
    })
    await submit(page).click()
    await expect(rowFields(bookingRow(page, 2)).alert).toBeVisible()

    await page.getByRole("button", { name: "Add booking" }).click()
    await expect(page.getByText("Ben is fully booked at this time.")).toHaveCount(0)
    await page.getByRole("button", { name: "Remove booking 3" }).click()

    await submit(page).click()
    await expect(rowFields(bookingRow(page, 2)).alert).toBeVisible()
    await page.getByRole("button", { name: "Remove booking 1" }).click()
    await expect(page.getByText("Ben is fully booked at this time.")).toHaveCount(0)
  })

  test("removing a row also clears the form's 'rejected booking N' summary", async ({ page, ui, net }) => {
    await openForm(page)
    await fillTwoRows(page, ui)
    await net.fail("booking-groups", {
      method: "POST",
      status: 422,
      body: { message: "The given data was invalid.", messages: { "bookings.1": "Ben is fully booked at this time." } },
    })
    await submit(page).click()
    const summary = page.getByText("Hapio rejected booking 2. See the details on that row.")
    await expect(summary).toBeVisible()

    // Booking 2 is now booking 1, so the summary points at a row that no longer exists.
    await page.getByRole("button", { name: "Remove booking 1" }).click()
    await expect(page.getByRole("group", { name: /^Booking \d+$/ })).toHaveCount(1)
    await expect(summary).toBeHidden()
  })

  test("adding a row clears the summary but keeps the form errors that don't name a row", async ({ page, ui, net }) => {
    await openForm(page)
    await fillTwoRows(page, ui)
    await net.fail("booking-groups", {
      method: "POST",
      status: 422,
      body: {
        message: "The given data was invalid.",
        errors: { foo: ["Unknown field."] },
        messages: { "bookings.1": "Ben is fully booked at this time." },
      },
    })
    await submit(page).click()
    await expect(formAlert(page)).toContainText("Hapio rejected booking 2. See the details on that row.")
    await expect(formAlert(page)).toContainText("foo: Unknown field.")

    await page.getByRole("button", { name: "Add booking" }).click()
    await expect(formAlert(page)).not.toContainText("Hapio rejected booking 2")
    await expect(formAlert(page)).toContainText("foo: Unknown field.")
  })

  test("a rejected override flag shows in the row alert", async ({ page, ui, net }) => {
    await openForm(page)
    await fillRow(ui, bookingRow(page, 1), { service: "Haircut", location: STHLM, starts: "2026-11-05T10:00" })
    await net.fail("booking-groups", {
      method: "POST",
      status: 422,
      body: {
        message: "The given data was invalid.",
        errors: { "bookings.0.ignore_schedule": ["The token lacks the booking:ignore_schedule ability."] },
      },
    })
    await submit(page).click()
    await expect(rowFields(bookingRow(page, 1)).alert).toContainText(
      "ignore_schedule: The token lacks the booking:ignore_schedule ability."
    )
    await expect(formAlert(page)).toContainText("Hapio rejected booking 1. See the details on that row.")
  })

  test("a metadata error from Hapio shows under the field", async ({ page, ui, net }) => {
    await openForm(page)
    await fillRow(ui, bookingRow(page, 1), { service: "Haircut", location: STHLM, starts: "2026-11-05T10:00" })
    await page.getByRole("textbox", { name: "Metadata", exact: true }).fill('{"party":"Holm"}')
    await net.fail("booking-groups", {
      method: "POST",
      status: 422,
      body: {
        message: "The given data was invalid.",
        errors: { metadata: ["The metadata may not be greater than 1000 characters."] },
      },
    })
    await submit(page).click()
    await expect(page.getByText("The metadata may not be greater than 1000 characters.")).toBeVisible()
    await expect(page.getByRole("textbox", { name: "Metadata", exact: true })).toHaveAttribute("aria-invalid", "true")
    await expect(formAlert(page)).toHaveCount(0)
    await expect(toasts(page)).toHaveCount(0)
  })

  test("a 422 without field details is toasted", async ({ page, ui, net }) => {
    await openForm(page)
    await fillRow(ui, bookingRow(page, 1), { service: "Haircut", location: STHLM, starts: "2026-11-05T10:00" })
    await net.fail("booking-groups", {
      method: "POST",
      status: 422,
      body: { message: "The bookings must not overlap." },
    })
    await submit(page).click()
    await expectToast(page, "The bookings must not overlap.", { type: "error" })
    await expect(formAlert(page)).toHaveCount(0)
    await expect(page).toHaveURL("/booking-groups/new")
  })

  test("a network failure is toasted and the form keeps its values", async ({ page, ui, net }) => {
    await openForm(page)
    await fillRow(ui, bookingRow(page, 1), { service: "Haircut", location: STHLM, starts: "2026-11-05T10:00" })
    await net.abort("booking-groups", { method: "POST" })
    await submit(page).click()
    await expectToast(page, "Network error: could not reach the admin server.", { type: "error" })
    await expect(page).toHaveURL("/booking-groups/new")
    await expect(rowFields(bookingRow(page, 1)).starts).toHaveValue("2026-11-05T10:00")
    await expect(submit(page)).toBeEnabled()
  })

  test("Cancel goes back to the list", async ({ page, ui }) => {
    await openForm(page)
    await page.getByRole("link", { name: "Cancel" }).click()
    await expect(page).toHaveURL("/booking-groups")
    await expect(ui.row("2 confirmed")).toBeVisible()
  })
})
