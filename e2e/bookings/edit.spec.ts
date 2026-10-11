import type { Page } from "@playwright/test"

import type { Ui } from "../helpers/ui"
import { expectNoToast, expectToast } from "../helpers/toasts"
import { bookingForm, bookingRowAction, expect, field, fieldError, seedBooking, test } from "./_helpers"

/** Opens a booking's detail page and its edit dialog. */
async function openEdit(page: Page, ui: Ui, id: string, title = "Haircut") {
  await page.goto(`/bookings/${id}`)
  await expect(ui.heading(title)).toBeVisible()
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  const dialog = ui.dialog("Edit booking")
  await expect(dialog).toBeVisible()
  const form = bookingForm(dialog)
  // The pickers have their options once they show names.
  await expect(form.service).toHaveText(title)
  return { dialog, form, save: () => dialog.getByRole("button", { name: "Save changes" }).click() }
}

test.describe("edit booking", () => {
  test("is prefilled from the booking", async ({ page, ui, api }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { dialog, form } = await openEdit(page, ui, erik.id)
    await expect(dialog).toContainText(
      "Only changed fields are sent. Price (now 450.00) and buffers are recalculated when the times or service change."
    )
    await expect(form.location).toHaveText("Stockholm Studio")
    await expect(form.resource).toHaveText("Anna")
    await expect(form.starts).toHaveValue("2026-10-22T09:00")
    await expect(form.ends).toHaveValue("2026-10-22T09:45")
    await expect(dialog.getByText("Length: 45 min. Changing the start keeps the length.")).toBeVisible()
    await expect(form.autoPrice).toBeChecked()
    await expect(form.price).toHaveValue("450.000")
    await expect(form.price).toBeDisabled()
    await expect(field(dialog, "Calculate price automatically")).toContainText(
      "Hapio recalculates it only when the service or times change."
    )
    await expect(form.canceled).not.toBeChecked()
    // Confirmed bookings can't become temporary again.
    await expect(form.temporary).toHaveCount(0)
    await expect(form.group).toHaveValue("")
    await expect(field(dialog, "Booking group")).toContainText("Clear to remove the booking from its group.")
    expect(JSON.parse(await form.metadata.inputValue())).toEqual(erik.metadata)
    // Edit forms offer the cancelation threshold override and no resource auto-select.
    await form.overrideRules.click()
    await expect(form.flag("Ignore cancelation threshold")).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Clear selection" })).toHaveCount(0)
  })

  test("changing the start sends start and end, keeping the length", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { dialog, form, save } = await openEdit(page, ui, erik.id)
    await form.starts.fill("2026-10-22T11:00")
    await expect(form.ends).toHaveValue("2026-10-22T11:45")
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await save()
    expect((await request).body).toEqual({
      starts_at: "2026-10-22T11:00:00+02:00",
      ends_at: "2026-10-22T11:45:00+02:00",
    })
    await expectToast(page, "Booking updated", { type: "success" })
    await expect(dialog).toBeHidden()
    await expect(page.getByRole("main")).toContainText("Thu 22 Oct 2026, 11:00–11:45")
  })

  test("changing only the metadata sends only the metadata", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { form, save } = await openEdit(page, ui, erik.id)
    await form.metadata.fill('{ "customer": { "name": "Erik Lund" }, "note": "Window seat" }')
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await save()
    expect((await request).body).toEqual({ metadata: { customer: { name: "Erik Lund" }, note: "Window seat" } })
    await expectToast(page, "Booking updated")
    expect((await api.get(`bookings/${erik.id}`)).metadata).toEqual({ customer: { name: "Erik Lund" }, note: "Window seat" })
  })

  test("clearing the metadata sends null", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { form, save } = await openEdit(page, ui, erik.id)
    await form.metadata.fill("")
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await save()
    expect((await request).body).toEqual({ metadata: null })
  })

  test("saving without changes sends nothing", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { dialog, save } = await openEdit(page, ui, erik.id)
    await save()
    await expectToast(page, "No changes to save", { type: "info" })
    await expect(dialog).toBeHidden()
    expect(net.mutations()).toEqual([])
  })

  test("a change that is undone counts as no change", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { form, save } = await openEdit(page, ui, erik.id)
    await form.canceled.click()
    await form.canceled.click()
    await save()
    await expectToast(page, "No changes to save")
    expect(net.mutations()).toEqual([])
  })

  test("Cancel discards the edits", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { dialog, form } = await openEdit(page, ui, erik.id)
    await form.starts.fill("2026-10-22T15:00")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    await expect(form.starts).toHaveValue("2026-10-22T09:00")
    await expect(form.ends).toHaveValue("2026-10-22T09:45")
    expect(net.mutations()).toEqual([])
  })

  test("Temporary is offered for temporary bookings and finalizes them", async ({ page, ui, api, net }) => {
    const ida = await seedBooking(api, "Ida Strand")
    const { dialog, form, save } = await openEdit(page, ui, ida.id)
    await expect(form.temporary).toBeChecked()
    await expect(field(dialog, "Temporary")).toContainText("Turn off to finalize the booking.")
    await form.temporary.click()
    const request = net.waitFor("PATCH", `bookings/${ida.id}`)
    await save()
    expect((await request).body).toEqual({ is_temporary: false })
    await expectToast(page, "Booking updated")
    await expect(page.getByRole("button", { name: "Finalize" })).toHaveCount(0)
  })

  test("the Canceled switch cancels", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { form, save } = await openEdit(page, ui, erik.id)
    await form.canceled.click()
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await save()
    expect((await request).body).toEqual({ is_canceled: true })
    await expectToast(page, "Booking updated")
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible()
  })

  test("canceling with the threshold override sends the flag", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { form, save } = await openEdit(page, ui, erik.id)
    await form.canceled.click()
    await form.overrideRules.click()
    await form.flag("Ignore cancelation threshold").click()
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await save()
    expect((await request).body).toEqual({ is_canceled: true, ignore_cancelation_threshold: true })
  })

  test("clearing the group removes the booking from it", async ({ page, ui, api, net }) => {
    const alva = await seedBooking(api, "Alva Lindqvist")
    const { form, save } = await openEdit(page, ui, alva.id)
    await expect(form.group).toHaveValue(alva.booking_group!.id)
    await form.clearGroup.click()
    await expect(form.group).toHaveValue("")
    const request = net.waitFor("PATCH", `bookings/${alva.id}`)
    await save()
    expect((await request).body).toEqual({ booking_group_id: null })
    await expectToast(page, "Booking updated")
    await expect(page.getByText("Not in a group")).toBeVisible()
  })

  test("a manual price is sent normalised", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { form, save } = await openEdit(page, ui, erik.id)
    await form.autoPrice.click()
    await expect(form.price).toBeEnabled()
    await form.price.fill("500")
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await save()
    expect((await request).body).toEqual({ price: "500.000" })
  })

  test("moving to New York keeps the wall times in the new zone", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const ny = await api.idOf("locations", "New York Loft")
    const { form, save } = await openEdit(page, ui, erik.id)
    await ui.pick(form.location, "New York Loft")
    await expect(form.starts).toHaveValue("2026-10-22T09:00")
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await save()
    expect((await request).body).toEqual({
      location_id: ny,
      starts_at: "2026-10-22T09:00:00-04:00",
      ends_at: "2026-10-22T09:45:00-04:00",
    })
  })

  test("editing from the list updates the row", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto("/bookings")
    await bookingRowAction(page, erik.id, "Edit")
    const dialog = ui.dialog("Edit booking")
    const form = bookingForm(dialog)
    await expect(form.service).toHaveText("Haircut")
    await form.starts.fill("2026-10-22T12:00")
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await request
    await expectToast(page, "Booking updated")
    await expect(dialog).toBeHidden()
    await expect(ui.row("12:00–12:45")).toHaveCount(1)
  })

  test("a 422 shows field errors inline and keeps the dialog open", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const message = "The starts at overlaps another booking."
    await net.fail(`bookings/${erik.id}`, {
      method: "PATCH",
      status: 422,
      body: { message, errors: { starts_at: [message], unknown_field: ["Something else is off."] } },
      times: 1,
    })
    const { dialog, form, save } = await openEdit(page, ui, erik.id)
    await form.starts.fill("2026-10-22T14:00")
    await save()
    await expect(fieldError(dialog, "Starts")).toHaveText(message)
    await expect(dialog.getByRole("alert").filter({ hasText: "Hapio rejected the request" })).toContainText(
      "Something else is off."
    )
    await expect(dialog).toBeVisible()
    await expectNoToast(page, message)

    // Closing clears the server errors.
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    await expect(fieldError(dialog, "Starts")).toHaveCount(0)
    await expect(dialog.getByText("Hapio rejected the request")).toHaveCount(0)
  })

  test("a 500 toasts and keeps the dialog open", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await net.fail(`bookings/${erik.id}`, { method: "PATCH", status: 500, body: { message: "Upstream timeout" }, times: 1 })
    const { dialog, form, save } = await openEdit(page, ui, erik.id)
    await form.canceled.click()
    await save()
    await expectToast(page, "Upstream timeout", { type: "error", close: false })
    await expect(dialog).toBeVisible()
    await expect(form.canceled).toBeChecked()
  })
})

test.describe("edit booking: price, cancelation and refetches", () => {
  test("switching automatic price off without changing it saves nothing", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { form, save } = await openEdit(page, ui, erik.id)
    await form.autoPrice.click()
    await expect(form.price).toHaveValue("450.000")
    await save()
    await expectToast(page, "No changes to save", { type: "info" })
    expect(net.mutations()).toEqual([])
  })

  test("with automatic price off, new times keep the price", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { form, save } = await openEdit(page, ui, erik.id)
    await form.autoPrice.click()
    await form.starts.fill("2026-10-22T11:00")
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await save()
    expect((await request).body).toEqual({
      starts_at: "2026-10-22T11:00:00+02:00",
      ends_at: "2026-10-22T11:45:00+02:00",
      price: "450.000",
    })
  })

  test("an unrelated edit of a canceled booking doesn't send the threshold override", async ({ page, ui, api, net }) => {
    const sara = await seedBooking(api, "Sara Ek")
    const { form, save } = await openEdit(page, ui, sara.id)
    await expect(form.canceled).toBeChecked()
    await form.overrideRules.click()
    await form.flag("Ignore cancelation threshold").click()
    await form.metadata.fill('{ "customer": { "name": "Sara Ek" }, "note": "Called back" }')
    const request = net.waitFor("PATCH", `bookings/${sara.id}`)
    await save()
    expect((await request).body).toEqual({ metadata: { customer: { name: "Sara Ek" }, note: "Called back" } })
  })

  test("a background refetch keeps the edits in progress", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const { dialog, form, save } = await openEdit(page, ui, erik.id)
    const typed = '{ "note": "typed while someone else edited" }'
    await form.metadata.fill(typed)

    // Someone else changes the booking; a reconnect refetches the (stale) booking.
    await api.patch(`bookings/${erik.id}`, { price: "999.000" })
    await page.clock.fastForward(31_000)
    const refetch = net.waitFor("GET", `bookings/${erik.id}`)
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"))
      window.dispatchEvent(new Event("online"))
    })
    await refetch
    await expect(dialog).toContainText("(now 999.00)")
    // Untouched fields follow the server; the typed metadata stays and is the only change.
    await expect(form.price).toHaveValue("999.000")
    await expect(form.metadata).toHaveValue(typed)
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await save()
    expect((await request).body).toEqual({ metadata: { note: "typed while someone else edited" } })
  })
})
