import type { Locator, Page } from "@playwright/test"

import { expectAccessible } from "../helpers/a11y"
import { recordAppearances } from "../helpers/flash"
import type { HapioApi } from "../fixtures/hapio-api"
import { expectNoToast, expectToast } from "../helpers/toasts"
import type { Ui } from "../helpers/ui"
import {
  expect,
  expectedPutBody,
  seedBooking,
  shortId,
  slowNavigationTo,
  test,
  type ApiBooking,
} from "./_helpers"

/** The value cell of a detail list item, by its label. */
function detail(page: Page, label: string): Locator {
  return page
    .locator("dl > div")
    .filter({ has: page.locator("dt").filter({ hasText: new RegExp(`^${label}$`) }) })
    .locator("dd")
}

/** A section card by its title. */
function section(page: Page, title: string): Locator {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]').filter({ hasText: new RegExp(`^${title}$`) }) })
}

const header = (page: Page) => page.getByRole("main").locator("h1").locator("xpath=ancestor::div[2]")

test.describe("booking detail: header", () => {
  test("shows title, status, time range and a copyable id", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(header(page)).toContainText("Confirmed")
    await expect(header(page)).toContainText("Thu 22 Oct 2026, 09:00–09:45")
    await expect(header(page)).toContainText(erik.id)
    await page.getByRole("button", { name: "Copy ID" }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(erik.id)
  })

  test("the breadcrumb names the booking", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    const crumbs = page.getByRole("navigation", { name: "breadcrumb" })
    await expect(crumbs).toContainText("Haircut · 22 Oct, 09:00")
    await crumbs.getByRole("link", { name: "Bookings" }).click()
    await expect(page).toHaveURL("/bookings")
  })

  test("a booking that doesn't exist shows a 404", async ({ page, ui }) => {
    await page.goto("/bookings/00000000-0000-4000-8000-000000000000")
    await expect(ui.main().getByText("Request failed (404)")).toBeVisible()
    await expect(ui.main().getByRole("button", { name: "Retry" })).toBeVisible()
  })

  test("Finalize is offered only for temporary bookings", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Finalize" })).toHaveCount(0)

    const ida = await seedBooking(api, "Ida Strand")
    await page.goto(`/bookings/${ida.id}`)
    await expect(header(page)).toContainText("Temporary")
    await expect(detail(page, "Status")).toContainText("Holds the time until it's finalized.")
    const request = net.waitFor("PATCH", `bookings/${ida.id}`)
    await page.getByRole("button", { name: "Finalize" }).click()
    expect((await request).body).toEqual({ is_temporary: false })
    await expectToast(page, "Booking finalized", { type: "success" })
    await expect(page.getByRole("button", { name: "Finalize" })).toHaveCount(0)
    await expect(header(page)).toContainText("Confirmed")
    await expect(detail(page, "Finalized")).not.toHaveText("Not yet")
  })

  test("Cancel and Restore toggle each other", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()

    await page.getByRole("button", { name: "Cancel booking" }).click()
    const dialog = ui.alertDialog("Cancel this booking?")
    await expect(dialog).toContainText("Haircut, Thu 22 Oct 2026, 09:00–09:45.")
    let request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await ui.confirm("Cancel this booking?", "Cancel booking")
    expect((await request).body).toEqual({ is_canceled: true })
    await expectToast(page, "Booking canceled", { type: "success" })
    await expect(header(page)).toContainText("Canceled")
    await expect(detail(page, "Status")).toContainText("Kept for the record; its time is free for other bookings.")
    await expect(detail(page, "Canceled")).not.toHaveText("—")

    request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await page.getByRole("button", { name: "Restore" }).click()
    expect((await request).body).toEqual({ is_canceled: false })
    await expectToast(page, "Booking restored", { type: "success" })
    await expect(page.getByRole("button", { name: "Cancel booking" })).toBeVisible()
    await expect(header(page)).toContainText("Confirmed")
    await expect(detail(page, "Canceled")).toHaveText("—")
  })

  test("canceling with the threshold bypass sends the flag", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await page.getByRole("button", { name: "Cancel booking" }).click()
    const dialog = ui.alertDialog("Cancel this booking?")
    await dialog.getByRole("checkbox", { name: "Ignore cancelation threshold" }).check()
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await ui.confirm("Cancel this booking?", "Cancel booking")
    expect((await request).body).toEqual({ is_canceled: true, ignore_cancelation_threshold: true })

    // The checkbox resets for the next time.
    await page.getByRole("button", { name: "Restore" }).click()
    await expectToast(page, "Booking restored")
    await page.getByRole("button", { name: "Cancel booking" }).click()
    await expect(dialog.getByRole("checkbox", { name: "Ignore cancelation threshold" })).not.toBeChecked()
  })
})

test.describe("booking detail: delete", () => {
  test("a confirmed booking suggests canceling instead", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    const dialog = ui.alertDialog("Delete this booking permanently?")
    await expect(dialog).toContainText(
      "The booking is removed for good and can't be restored. To free up its time but keep a record, cancel it instead."
    )
    await ui.dismiss("Delete this booking permanently?")
    expect(net.mutations()).toEqual([])
  })

  test("a canceled booking doesn't", async ({ page, api, ui }) => {
    const sara = await seedBooking(api, "Sara Ek")
    await page.goto(`/bookings/${sara.id}`)
    await expect(header(page)).toContainText("Canceled")
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    const dialog = ui.alertDialog("Delete this booking permanently?")
    await expect(dialog.getByText("The booking is removed for good and can't be restored.", { exact: true })).toBeVisible()
    await expect(dialog).not.toContainText("cancel it instead")
  })

  test("deleting goes back to the list", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    const request = net.waitFor("DELETE", `bookings/${erik.id}`)
    await ui.confirm("Delete this booking permanently?", "Delete booking")
    await request
    await expectToast(page, "Booking deleted", { type: "success" })
    await expect(page).toHaveURL("/bookings")
    await expect(ui.main().getByRole("table").locator("tbody tr")).toHaveCount(12)
    await expect(api.get(`bookings/${erik.id}`)).rejects.toMatchObject({ status: 404 })
  })

  test("no 404 error flashes after deleting, and the deleted booking isn't fetched again", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    // On a slow connection the navigation to the list takes a moment; meanwhile the
    // blanket invalidation refetches the deleted booking (404) and the page shows it.
    await slowNavigationTo(page, "/bookings")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    const appeared = await recordAppearances(page, '[data-slot="alert"]', "Request failed (404)")
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await ui.confirm("Delete this booking permanently?", "Delete booking")
    await expect(page).toHaveURL("/bookings")
    await expect(ui.main().getByRole("table").locator("tbody tr")).toHaveCount(12)
    expect(await appeared()).toBe(false)
    const deleteAt = net.calls.findIndex((c) => c.method === "DELETE")
    expect(net.calls.slice(deleteAt).filter((c) => c.method === "GET" && c.path === `bookings/${erik.id}`)).toEqual([])
  })
})

test.describe("booking detail: time", () => {
  test("timeline with a buffer after", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    const time = section(page, "Time")
    await expect(time.getByRole("img", { name: "Buffer before 0 min, booking 45 min, buffer after 15 min" })).toBeVisible()
    const points = time.getByRole("listitem")
    await expect(points).toHaveCount(4)
    await expect(points.nth(0)).toContainText("Buffer start09:00Thu 22 Oct 2026")
    await expect(points.nth(1)).toContainText("Start09:00Thu 22 Oct 2026")
    await expect(points.nth(2)).toContainText("End09:45Thu 22 Oct 2026")
    await expect(points.nth(3)).toContainText("Buffer end10:00Thu 22 Oct 2026")
    await expect(time).toContainText(
      "The resource is blocked for 1 h in total, including 0 min before and 15 min after. Times are local to the location (Europe/Stockholm, UTC+02:00)."
    )
  })

  test("timeline without buffers, after the DST change", async ({ page, api, ui }) => {
    const fotostudion = await seedBooking(api, "Fotostudion AB")
    await page.goto(`/bookings/${fotostudion.id}`)
    await expect(ui.heading("Equipment rental")).toBeVisible()
    await expect(header(page)).toContainText("26 Oct 2026, 09:00 → 27 Oct 2026, 17:00")
    const time = section(page, "Time")
    await expect(time.getByRole("img", { name: "Buffer before 0 min, booking 1 day 8 h, buffer after 0 min" })).toBeVisible()
    await expect(time).toContainText(
      "No buffers: the resource is blocked only during the booking. Times are local to the location (Europe/Stockholm, UTC+01:00)."
    )
  })

  test("a New York booking shows New York time", async ({ page, api, ui }) => {
    const jamie = await seedBooking(api, "Jamie Carter")
    await page.goto(`/bookings/${jamie.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(header(page)).toContainText("Thu 29 Oct 2026, 10:00–10:45")
    await expect(section(page, "Time")).toContainText("(America/New_York, UTC-04:00)")
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("Haircut · 29 Oct, 10:00")
  })
})

test.describe("booking detail: details and history", () => {
  test("links to the service, resource and location", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(detail(page, "Service")).toContainText("Fixed · 45 min")
    await expect(detail(page, "Location")).toContainText("Europe/Stockholm")
    await expect(detail(page, "Status")).toContainText("Finalized and blocking its time.")
    await expect(detail(page, "Price")).toHaveText("450.00")
    await expect(detail(page, "Booking group")).toContainText("Not in a group")
    await expect(detail(page, "Booking group").getByRole("button", { name: "Add to group" })).toBeVisible()

    await detail(page, "Resource").getByRole("link", { name: "Anna" }).click()
    await expect(page).toHaveURL(`/resources/${erik.resource!.id}`)
    await page.goBack()
    await detail(page, "Location").getByRole("link", { name: "Stockholm Studio" }).click()
    await expect(page).toHaveURL(`/locations/${erik.location!.id}`)
    await page.goBack()
    await detail(page, "Service").getByRole("link", { name: "Haircut" }).click()
    await expect(page).toHaveURL(`/services/${erik.service!.id}`)
  })

  test("a flexible service and a group", async ({ page, api, ui }) => {
    const alva = await seedBooking(api, "Alva Lindqvist")
    await page.goto(`/bookings/${alva.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    const group = detail(page, "Booking group")
    await expect(group.getByRole("link", { name: `${shortId(alva.booking_group!.id)}…` })).toHaveAttribute(
      "href",
      `/booking-groups/${alva.booking_group!.id}`
    )
    await expect(group).toContainText("party, note")
    await expect(group.getByRole("button", { name: "Move", exact: true })).toBeVisible()
    await expect(group.getByRole("button", { name: "Remove", exact: true })).toBeVisible()

    const lumen = await seedBooking(api, "Lumen Collective")
    await page.goto(`/bookings/${lumen.id}`)
    await expect(ui.heading("Studio rental")).toBeVisible()
    await expect(detail(page, "Service")).toContainText("Flexible length")
    await expect(detail(page, "Price")).toHaveText("600.00")
  })

  test("deleted service and resource", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await api.delete(`services/${erik.service!.id}`)
    await api.delete(`resources/${erik.resource!.id}`)
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading(/^Booking$/)).toBeVisible()
    await expect(detail(page, "Service")).toHaveText("No service")
    await expect(detail(page, "Resource")).toHaveText("No resource")
    await expect(detail(page, "Location")).toContainText("Stockholm Studio")
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("Booking · 22 Oct, 09:00")
    // Times are still shown, without a service summary.
    await expect(section(page, "Time")).toContainText("Times are local to the location (Europe/Stockholm, UTC+02:00).")
  })

  test("deleted location", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await api.delete(`locations/${erik.location!.id}`)
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(detail(page, "Location")).toHaveText("No location")
    // Without a location only the timestamp's offset is known (the mock then answers in UTC).
    await expect(section(page, "Time")).toContainText(/Times are local to the location \(UTC[^)]*\)\./)
    await expect(section(page, "Time")).not.toContainText("Europe/Stockholm")
  })

  test("no price", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await api.patch(`bookings/${erik.id}`, { price: null })
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(detail(page, "Price")).toHaveText("No price")
  })

  test("history: temporary bookings aren't finalized yet", async ({ page, api, ui }) => {
    const ida = await seedBooking(api, "Ida Strand")
    await page.goto(`/bookings/${ida.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(detail(page, "Finalized")).toHaveText("Not yet")
    await expect(detail(page, "Canceled")).toHaveText("—")
    await expect(detail(page, "Created")).toHaveText(/^\d{1,2} \w{3} 2026, \d{2}:\d{2} \(UTC(\+\d{2}:\d{2})?\)$/)
  })

  test("history: canceled bookings show when", async ({ page, api, ui }) => {
    const sara = await seedBooking(api, "Sara Ek")
    expect(sara.canceled_at).toBeTruthy()
    await page.goto(`/bookings/${sara.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(detail(page, "Canceled")).toHaveText(/^\d{1,2} \w{3} 2026, \d{2}:\d{2} \(UTC(\+\d{2}:\d{2})?\)$/)
    await expect(detail(page, "Finalized")).toHaveText(/2026/)
  })

  test("metadata and protected metadata", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(section(page, "Metadata")).toContainText('"name": "Erik Lund"')
    await expect(section(page, "Metadata")).toContainText('"vip": true')
    await expect(section(page, "Protected metadata")).toContainText("null")
    await expect(section(page, "Protected metadata")).not.toContainText("Not returned")
  })

  test("without the protected metadata ability, says so", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await net.transform(`bookings/${erik.id}`, (json) => {
      const rest = { ...(json as Record<string, unknown>) }
      delete rest.protected_metadata
      return rest
    })
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(section(page, "Protected metadata")).toContainText(
      "Not returned: the token lacks booking:protected_metadata."
    )
    // The PUT body then leaves protected metadata alone.
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const body = JSON.parse(await ui.dialog("Replace via JSON").getByRole("textbox", { name: "JSON body" }).inputValue())
    expect(body).not.toHaveProperty("protected_metadata")
  })
})

test.describe("booking detail: JSON", () => {
  test("shows the raw response", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await ui.tab("JSON")
    await expect(ui.main().locator("pre").filter({ hasText: `"id": "${erik.id}"` })).toBeVisible()
  })

  test("Replace (PUT) is prefilled with the writable fields and sends them", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const textarea = dialog.getByRole("textbox", { name: "JSON body" })
    const expected = expectedPutBody((await api.get(`bookings/${erik.id}`)) as ApiBooking)
    expect(expected).toMatchObject({
      resource_id: erik.resource!.id,
      service_id: erik.service!.id,
      location_id: erik.location!.id,
      booking_group_id: null,
    })
    expect(JSON.parse(await textarea.inputValue())).toEqual(expected)

    const request = net.waitFor("PUT", `bookings/${erik.id}`)
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    expect((await request).body).toEqual(expected)
    await expectToast(page, "Booking replaced", { type: "success" })
    await expect(dialog).toBeHidden()
  })

  test("an edited body is sent; invalid JSON is caught first", async ({ page, api, ui, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const textarea = dialog.getByRole("textbox", { name: "JSON body" })
    const body = JSON.parse(await textarea.inputValue())

    await textarea.fill("{ nope")
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    await expect(textarea).toHaveAttribute("aria-invalid", "true")
    await expect(dialog.getByText(/in JSON at position/)).toBeVisible()
    expect(net.mutations()).toEqual([])

    await textarea.fill(JSON.stringify({ ...body, price: "999.000" }, null, 2))
    const request = net.waitFor("PUT", `bookings/${erik.id}`)
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    expect((await request).body).toMatchObject({ price: "999.000" })
    await expectToast(page, "Booking replaced")
    await ui.tab("Overview")
    await expect(detail(page, "Price")).toHaveText("999.00")
    expect((await api.get(`bookings/${erik.id}`)).price).toBe("999.000")
  })

  test("a rejected PUT shows the error in the dialog, not in a toast", async ({ page, api, ui }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const textarea = dialog.getByRole("textbox", { name: "JSON body" })
    const body = JSON.parse(await textarea.inputValue())
    await textarea.fill(JSON.stringify({ ...body, ends_at: body.starts_at }))
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    await expect(dialog.getByText("Request failed (422)")).toBeVisible()
    await expect(dialog.getByText("ends_at", { exact: true })).toBeVisible()
    await expect(dialog).toContainText("The ends at must be a date after starts at.")
    await expect(dialog).toBeVisible()
    await expectNoToast(page, "The given data was invalid.")
  })
})

test.describe("booking detail: accessibility", () => {
  /** The overview, then the edit dialog. */
  async function sweep(page: Page, api: HapioApi, ui: Ui, check: (include: string) => Promise<void>) {
    const alva = await seedBooking(api, "Alva Lindqvist")
    await page.goto(`/bookings/${alva.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await check("main")
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    const dialog = ui.dialog("Edit booking")
    await expect(dialog.getByRole("combobox", { name: "Service", exact: true })).toHaveText("Haircut")
    await check('[role="dialog"]')
  }

  test(
    "the overview and the edit dialog have no serious violations",
    async ({ page, api, ui }) => {
      await sweep(page, api, ui, (include) => expectAccessible(page, { include }))
    }
  )
})
