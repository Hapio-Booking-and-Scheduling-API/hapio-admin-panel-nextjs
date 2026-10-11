import type { Page } from "@playwright/test"

import { expectAccessible } from "../helpers/a11y"
import { expectNoToast, expectToast } from "../helpers/toasts"
import type { Ui } from "../helpers/ui"
import { bookingForm, expect, field, fieldError, test } from "./_helpers"

const isCreate = (path: string) => path === "bookings"

/** Opens /bookings/new and waits until the pickers have their options. */
async function openNew(page: Page, ui: Ui) {
  await page.goto("/bookings/new")
  await expect(ui.heading("New booking")).toBeVisible()
  const form = bookingForm(page)
  // API-derived: the service picker lists the seed services.
  await form.service.click()
  await expect(page.getByRole("option", { name: /^Haircut/ })).toBeVisible()
  await page.keyboard.press("Escape")
  return form
}

/** Opens /bookings/new and fills service, location and start; the end follows from the service. */
async function fillBasics(
  page: Page,
  ui: Ui,
  options: { service?: string; location?: string; start?: string } = {}
) {
  const form = await openNew(page, ui)
  await ui.pick(form.service, options.service ?? "Haircut")
  await ui.pick(form.location, options.location ?? "Stockholm Studio")
  await form.starts.fill(options.start ?? "2026-10-22T11:00")
  return form
}

const submit = (page: Page) => page.getByRole("button", { name: "Create booking" }).click()

test.describe("create booking: fields", () => {
  test("requires service, location and times", async ({ page, ui, net }) => {
    await openNew(page, ui)
    await expect(page.getByText("Book a service at a location. Hapio checks availability unless you override its rules.")).toBeVisible()
    await submit(page)
    await expect(fieldError(page, "Service")).toHaveText("Select a service")
    await expect(fieldError(page, "Location")).toHaveText("Select a location")
    await expect(fieldError(page, "Starts")).toHaveText("Required")
    await expect(fieldError(page, "Ends")).toHaveText("Required")
    expect(net.mutations()).toEqual([])
  })

  test("the resource picker offers the service's resources", async ({ page, ui }) => {
    const form = await openNew(page, ui)
    await expect(field(page, "Resource")).toContainText(
      "Leave empty to let Hapio pick one using the location's selection strategy."
    )
    await ui.pick(form.service, "Haircut")
    const resource = field(page, "Resource")
    await expect(resource).toContainText("Showing the 3 resources that provide this service.")
    await form.resource.click()
    await expect(page.getByRole("option")).toHaveCount(3)
    await page.keyboard.press("Escape")

    await ui.pick(form.service, "Equipment rental")
    await form.resource.click()
    await expect(page.getByRole("option")).toHaveText(["Room A"])
    await page.keyboard.press("Escape")

    await resource.getByRole("button", { name: "Show all" }).click()
    await expect(resource).toContainText("Showing every resource.")
    await ui.pick(form.resource, "Anna")
    await expect(resource).toContainText("This resource isn't associated with the selected service.")
    await resource.getByRole("button", { name: "Only matching" }).click()
    await expect(resource).toContainText("Showing the resource")
    // The chosen resource stays selectable even though it doesn't match.
    await expect(form.resource).toHaveText("Anna")
    await expect(resource).toContainText("This resource isn't associated with the selected service.")
    await resource.getByRole("button", { name: "Clear selection" }).click()
    await expect(form.resource).toHaveText("Auto-select")
    await expect(resource).not.toContainText("isn't associated")
  })

  test("the helper text agrees in number with a single resource", async ({ page, ui }) => {
    const form = await openNew(page, ui)
    await ui.pick(form.service, "Equipment rental")
    await expect(field(page, "Resource")).toContainText("Showing the resource that provides this service.")
  })

  test("names the location's time zone", async ({ page, ui }) => {
    const form = await openNew(page, ui)
    await expect(field(page, "Location")).toContainText("Times are entered in the location's time zone.")
    await ui.pick(form.location, "Stockholm Studio")
    await expect(field(page, "Location")).toContainText("Times are in Europe/Stockholm.")
    await expect(field(page, "Starts")).toContainText("Europe/Stockholm")
    await ui.pick(form.location, "New York Loft")
    await expect(field(page, "Location")).toContainText("Times are in America/New_York.")
  })

  test("picking a start fills the end from the service and keeps the length", async ({ page, ui }) => {
    const form = await openNew(page, ui)
    await ui.pick(form.service, "Haircut")
    await ui.pick(form.location, "Stockholm Studio")
    await expect(page.getByText("Changing the start keeps the booking's length.")).toBeVisible()
    await form.starts.fill("2026-10-22T10:00")
    await expect(form.ends).toHaveValue("2026-10-22T10:45")
    await expect(page.getByText("Length: 45 min. Changing the start keeps the length.")).toBeVisible()

    await form.ends.fill("2026-10-22T11:30")
    await expect(page.getByText("Length: 1 h 30 min.", { exact: false })).toBeVisible()
    await form.starts.fill("2026-10-22T13:00")
    await expect(form.ends).toHaveValue("2026-10-22T14:30")
  })

  test("the start keeps the length across the DST change", async ({ page, ui }) => {
    const form = await openNew(page, ui)
    await ui.pick(form.service, "Haircut")
    await ui.pick(form.location, "Stockholm Studio")
    await form.starts.fill("2026-10-23T10:00")
    await expect(form.ends).toHaveValue("2026-10-23T10:45")
    await form.starts.fill("2026-10-26T10:00")
    await expect(form.ends).toHaveValue("2026-10-26T10:45")
  })

  test("choosing a service after the start fills the end", async ({ page, ui }) => {
    const form = await openNew(page, ui)
    await ui.pick(form.location, "Stockholm Studio")
    await form.starts.fill("2026-10-22T10:00")
    await expect(form.ends).toHaveValue("")
    await ui.pick(form.service, "Haircut")
    await expect(form.ends).toHaveValue("2026-10-22T10:45")
  })

  test("a flexible service starts with its minimum length", async ({ page, ui }) => {
    const form = await fillBasics(page, ui, { service: "Studio rental", start: "2026-10-22T10:00" })
    await expect(form.ends).toHaveValue("2026-10-22T11:00")
    await expect(page.getByText("Length: 1 h. Changing the start keeps the length.")).toBeVisible()
  })

  test("an end before the start is rejected", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await form.ends.fill("2026-10-22T10:00")
    await submit(page)
    await expect(fieldError(page, "Ends")).toHaveText("Must be after the start")
    expect(net.mutations()).toEqual([])
  })

  test("switching to New York keeps the wall times", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui, { start: "2026-10-22T10:00" })
    await expect(form.ends).toHaveValue("2026-10-22T10:45")
    await ui.pick(form.location, "New York Loft")
    await expect(form.starts).toHaveValue("2026-10-22T10:00")
    await expect(form.ends).toHaveValue("2026-10-22T10:45")
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    expect((await request).body).toMatchObject({
      starts_at: "2026-10-22T10:00:00-04:00",
      ends_at: "2026-10-22T10:45:00-04:00",
    })
    await expectToast(page, "Booking created")
  })
})

test.describe("create booking: request body", () => {
  test("a minimal booking sends only what's needed; Hapio picks the resource", async ({ page, ui, net, api }) => {
    await fillBasics(page, ui)
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    const sthlm = await api.idOf("locations", "Stockholm Studio")
    const haircut = await api.idOf("services", "Haircut")
    expect((await request).body).toEqual({
      service_id: haircut,
      location_id: sthlm,
      starts_at: "2026-10-22T11:00:00+02:00",
      ends_at: "2026-10-22T11:45:00+02:00",
    })
    await expectToast(page, "Booking created", { type: "success" })
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/)
    await expect(ui.heading("Haircut")).toBeVisible()
    // Stockholm prioritises Anna, who is free at 11:00.
    await expect(page.getByRole("link", { name: "Anna" })).toBeVisible()
    await expect(page.getByText("Thu 22 Oct 2026, 11:00–11:45")).toBeVisible()
  })

  test("a chosen resource is sent", async ({ page, ui, net, api }) => {
    const form = await fillBasics(page, ui)
    await ui.pick(form.resource, "Ben")
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    expect((await request).body).toMatchObject({ resource_id: await api.idOf("resources", "Ben") })
  })

  test("price: automatic sends no price", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await expect(form.autoPrice).toBeChecked()
    await expect(form.price).toBeDisabled()
    await expect(form.price).toHaveAttribute("placeholder", "Calculated by Hapio")
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    expect((await request).body).not.toHaveProperty("price")
  })

  test("price: manual and empty sends null", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await form.autoPrice.click()
    await expect(form.price).toBeEnabled()
    await expect(field(page, "Price")).toContainText("Leave empty for no price.")
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    expect((await request).body).toMatchObject({ price: null })
  })

  test("price: manual 500 is normalised", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await form.autoPrice.click()
    await form.price.fill("500")
    await form.price.blur()
    await expect(form.price).toHaveValue("500.000")
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    expect((await request).body).toMatchObject({ price: "500.000" })
    await expect(page.getByText("500.00", { exact: true })).toBeVisible()
  })

  test("price: an invalid manual price blocks the form", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await form.autoPrice.click()
    await form.price.fill("12.3456")
    await submit(page)
    await expect(fieldError(page, "Price")).toHaveText("Use a number with up to 12 digits and 3 decimals, e.g. 149.000")
    expect(net.mutations()).toEqual([])
  })

  test("a hidden invalid price doesn't block an automatic price", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await form.autoPrice.click()
    await form.price.fill("abc")
    await form.autoPrice.click()
    await expect(form.price).toHaveValue("")
    await submit(page)
    await expect.poll(() => net.find("POST", isCreate).length, { timeout: 3_000 }).toBe(1)
  })

  test("Temporary", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await expect(form.temporary).not.toBeChecked()
    await form.temporary.click()
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    expect((await request).body).toMatchObject({ is_temporary: true })
    await expect(page.getByRole("button", { name: "Finalize" })).toBeVisible()
  })

  test("metadata is validated and sent as an object", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await form.metadata.fill("{")
    // The editor reports the parse error as you type.
    await expect(field(page, "Metadata").getByText(/in JSON at position/)).toBeVisible()
    await submit(page)
    await expect(fieldError(page, "Metadata")).toBeVisible()
    await form.metadata.fill("[1, 2]")
    await submit(page)
    await expect(fieldError(page, "Metadata")).toHaveText("Metadata must be a JSON object.")
    expect(net.mutations()).toEqual([])

    await form.metadata.fill('{ "customer": { "name": "Ada Lovelace" } }')
    await expect(field(page, "Metadata")).toContainText("Valid JSON object")
    await form.protectedMetadata.fill('{ "vip": true }')
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    expect((await request).body).toMatchObject({
      metadata: { customer: { name: "Ada Lovelace" } },
      protected_metadata: { vip: true },
    })
  })

  test("empty metadata is left out", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await form.metadata.fill("   ")
    await form.protectedMetadata.fill("null")
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    const body = (await request).body as Record<string, unknown>
    expect(body).not.toHaveProperty("metadata")
    expect(body).not.toHaveProperty("protected_metadata")
  })
})

test.describe("create booking: booking group", () => {
  test("an invalid group id is rejected", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await expect(field(page, "Booking group")).toContainText("Optional. Paste an ID or pick a recent group.")
    await form.group.fill("not-a-group")
    await submit(page)
    await expect(fieldError(page, "Booking group")).toHaveText("Not a valid booking group ID")
    expect(net.mutations()).toEqual([])
  })

  test("pick a recent group, clear it, pick it again", async ({ page, ui, net, api }) => {
    const [group] = await api.list<{ id: string }>("booking-groups")
    const form = await fillBasics(page, ui)
    await form.recentGroups.click()
    const option = page.getByRole("option", { name: /2 bookings · 3 Nov 2026 · Haircut/ })
    await expect(option).toBeVisible()
    await expect(option).toContainText(group.id.slice(0, 8))
    await option.click()
    await expect(form.group).toHaveValue(group.id)

    await form.clearGroup.click()
    await expect(form.group).toHaveValue("")
    await expect(form.clearGroup).toBeHidden()

    await form.recentGroups.click()
    await page.getByRole("option", { name: /2 bookings/ }).click()
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    expect((await request).body).toMatchObject({ booking_group_id: group.id })
    await expectToast(page, "Booking created")
    await expect(page.getByRole("link", { name: `${group.id.slice(0, 8)}…` })).toBeVisible()
  })
})

test.describe("create booking: override rules", () => {
  test("collapsed by default; only switched-on flags are sent", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await expect(form.overrideRules).toHaveAttribute("aria-expanded", "false")
    await expect(form.flag("Ignore schedule")).toBeHidden()
    await form.overrideRules.click()
    await expect(form.overrideRules).toHaveAttribute("aria-expanded", "true")
    // Create forms don't offer the cancelation threshold.
    await expect(form.flag("Ignore cancelation threshold")).toHaveCount(0)

    await form.flag("Ignore schedule").click()
    await form.flag("Ignore booking window").click()
    await expect(form.overrideRules).toContainText("2 on")
    // Ignoring the schedule implies ignoring bookable slots.
    await expect(form.flag("Ignore bookable slots")).toBeChecked()
    await expect(form.flag("Ignore bookable slots")).toBeDisabled()
    await expect(form.flag("Ignore fully booked")).not.toBeChecked()

    const request = net.waitFor("POST", isCreate)
    await submit(page)
    const body = (await request).body as Record<string, unknown>
    expect(body).toMatchObject({ ignore_schedule: true, ignore_booking_window: true })
    expect(body).not.toHaveProperty("ignore_bookable_slots")
    expect(body).not.toHaveProperty("ignore_fully_booked")
    expect(body).not.toHaveProperty("ignore_cancelation_threshold")
  })

  test("switching a flag off again removes it", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await form.overrideRules.click()
    await form.flag("Ignore fully booked").click()
    await expect(form.overrideRules).toContainText("1 on")
    await form.flag("Ignore fully booked").click()
    await expect(form.overrideRules).not.toContainText("on")
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    expect((await request).body).not.toHaveProperty("ignore_fully_booked")
  })

  test("a 422 on a flag inside the collapsed section opens it", async ({ page, ui, net }) => {
    const message = "The API token lacks the booking:ignore_schedule ability."
    await net.fail(isCreate, {
      method: "POST",
      status: 422,
      body: { message, errors: { ignore_schedule: [message] } },
    })
    const form = await fillBasics(page, ui)
    await form.overrideRules.click()
    await form.flag("Ignore schedule").click()
    await form.overrideRules.click()
    await expect(form.overrideRules).toHaveAttribute("aria-expanded", "false")
    await submit(page)
    await expect(fieldError(page, "Ignore schedule")).toHaveText(message)
    await expect(form.overrideRules).toHaveAttribute("aria-expanded", "true")

    // Fixing the flag clears the error; the section stays open until closed by hand.
    await form.flag("Ignore schedule").click()
    await expect(fieldError(page, "Ignore schedule")).toHaveCount(0)
    await expect(form.overrideRules).toHaveAttribute("aria-expanded", "true")
    await form.overrideRules.click()
    await expect(form.overrideRules).toHaveAttribute("aria-expanded", "false")
  })
})

test.describe("create booking: custom buffers", () => {
  test("need Ignore bookable slots, default to the booking times, and are sent", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await expect(form.customBuffers).toHaveAttribute("aria-expanded", "false")
    await form.customBuffers.click()
    await expect(field(page, "Set buffers manually")).toContainText("(0 min before, 15 min after)")
    await expect(form.bufferStarts).toBeDisabled()
    await form.setBuffers.click()
    await expect(form.customBuffers).toContainText("On")
    await expect(form.bufferStarts).toHaveValue("2026-10-22T11:00")
    await expect(form.bufferEnds).toHaveValue("2026-10-22T11:45")

    await submit(page)
    await expect(fieldError(page, "Set buffers manually")).toHaveText(
      "Custom buffers need “Ignore bookable slots” (under Override rules)."
    )
    expect(net.mutations()).toEqual([])

    await form.overrideRules.click()
    await form.flag("Ignore bookable slots").click()
    await form.bufferStarts.fill("2026-10-22T11:15")
    await form.bufferEnds.fill("2026-10-22T11:30")
    await submit(page)
    await expect(fieldError(page, "Buffer starts")).toHaveText("Must be at or before the start")
    await expect(fieldError(page, "Buffer ends")).toHaveText("Must be at or after the end")

    await form.bufferStarts.fill("2026-10-22T10:30")
    await form.bufferEnds.fill("2026-10-22T12:15")
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    expect((await request).body).toMatchObject({
      ignore_bookable_slots: true,
      buffer_starts_at: "2026-10-22T10:30:00+02:00",
      buffer_ends_at: "2026-10-22T12:15:00+02:00",
    })
    await expectToast(page, "Booking created")
    await expect(page.getByRole("img", { name: "Buffer before 30 min, booking 45 min, buffer after 30 min" })).toBeVisible()
  })

  test("buffers aren't sent while switched off", async ({ page, ui, net }) => {
    const form = await fillBasics(page, ui)
    await form.customBuffers.click()
    await form.setBuffers.click()
    await form.setBuffers.click()
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    const body = (await request).body as Record<string, unknown>
    expect(body).not.toHaveProperty("buffer_starts_at")
    expect(body).not.toHaveProperty("buffer_ends_at")
  })
})

test.describe("create booking: server responses", () => {
  test("a 422 shows field errors inline and the rest in an alert, without a toast", async ({ page, ui, net }) => {
    await net.fail(isCreate, {
      method: "POST",
      status: 422,
      body: {
        message: "The starts at is not bookable. (and 1 more error)",
        errors: {
          starts_at: ["The starts at is not bookable."],
          customer: ["The customer is blocked."],
        },
      },
      times: 1,
    })
    await fillBasics(page, ui)
    await submit(page)
    await expect(fieldError(page, "Starts")).toHaveText("The starts at is not bookable.")
    const alert = page.getByRole("alert").filter({ hasText: "Hapio rejected the request" })
    await expect(alert).toContainText("The customer is blocked.")
    await expectNoToast(page, "not bookable")
    await expect(page).toHaveURL("/bookings/new")
    await expect(page.getByRole("button", { name: "Create booking" })).toBeEnabled()

    // A successful retry clears the alert.
    await submit(page)
    await expectToast(page, "Booking created")
  })

  test("a 500 shows a toast and keeps the form", async ({ page, ui, net }) => {
    await net.fail(isCreate, { method: "POST", status: 500, body: { message: "Hapio had a hiccup." }, times: 1 })
    const form = await fillBasics(page, ui)
    await submit(page)
    await expectToast(page, "Hapio had a hiccup.", { type: "error" })
    await expect(page).toHaveURL("/bookings/new")
    await expect(form.starts).toHaveValue("2026-10-22T11:00")
  })

  test("a network failure shows a toast", async ({ page, ui, net }) => {
    await net.abort(isCreate, { method: "POST", times: 1 })
    await fillBasics(page, ui)
    await submit(page)
    await expectToast(page, "Network error: could not reach the admin server.", { type: "error" })
  })

  test("the submit button is busy while the request is pending", async ({ page, ui, net }) => {
    await net.delay(isCreate, 1_500, { method: "POST" })
    await fillBasics(page, ui)
    await submit(page)
    const button = page.getByRole("button", { name: "Create booking" })
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute("aria-busy", "true")
    await expectToast(page, "Booking created")
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/)
    expect(net.find("POST", isCreate)).toHaveLength(1)
  })

  test("Cancel goes back to the list", async ({ page, ui, net }) => {
    await openNew(page, ui)
    await page.getByRole("link", { name: "Cancel" }).click()
    await expect(page).toHaveURL("/bookings")
    await expect(ui.heading("Bookings")).toBeVisible()
    expect(net.mutations()).toEqual([])
  })
})

test.describe("create booking: a service nobody provides", () => {
  test("the picker says so and Hapio's 422 lands on the resource field", async ({ page, ui, api, net }) => {
    await api.post("services", { name: "Massage", type: "fixed", duration: "PT1H", price: "800.000" })
    const form = await fillBasics(page, ui, { service: "Massage" })
    await expect(form.resource).toHaveText("No resources for this service")
    await expect(field(page, "Resource")).toContainText("No resources provide this service yet.")
    await expect(form.ends).toHaveValue("2026-10-22T12:00")
    const request = net.waitFor("POST", isCreate)
    await submit(page)
    await request
    await expect(fieldError(page, "Resource")).toHaveText(
      "No resource is associated with this service, so the booking can't be placed."
    )
    await expectNoToast(page, "No resource is associated")
    await expect(page).toHaveURL("/bookings/new")
  })
})

test.describe("create booking: accessibility", () => {
  /** The empty form, then with errors and both sections open. */
  async function sweep(page: Page, ui: Ui, check: () => Promise<void>) {
    const form = await openNew(page, ui)
    await check()
    await submit(page)
    await expect(fieldError(page, "Service")).toBeVisible()
    await form.overrideRules.click()
    await form.customBuffers.click()
    await check()
  }

  test("the form has no serious violations, also with errors", async ({ page, ui }) => {
    await sweep(page, ui, () => expectAccessible(page, { include: "main" }))
  })
})
