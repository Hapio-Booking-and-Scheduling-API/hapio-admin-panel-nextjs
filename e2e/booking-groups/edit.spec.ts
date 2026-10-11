import type { Locator, Page } from "@playwright/test"

import { expect, test } from "../fixtures/test"
import type { Ui } from "../helpers/ui"
import { expectToast } from "../helpers/toasts"
import {
  allowDateSubclasses,
  bookingRow,
  byStart,
  customerOf,
  detailValue,
  getGroup,
  rowFields,
  seedGroup,
  seedIds,
  short,
  type Group,
  type GroupBooking,
} from "./_helpers"

/** Opens the detail page and the edit dialog. */
async function openEdit(page: Page, ui: Ui, group: Group, button: "Edit" | "Edit bookings" = "Edit") {
  await page.goto(`/booking-groups/${group.id}`)
  await expect(ui.heading(`Booking group ${short(group.id)}`)).toBeVisible()
  await ui.main().getByRole("button", { name: button, exact: true }).click()
  const dialog = ui.dialog(`Edit booking group ${short(group.id)}`)
  await expect(dialog).toBeVisible()
  return dialog
}

/** The seed group's bookings in dialog order (both start at 10:00; Alva comes first). */
function rows(group: Group) {
  const [first, second] = byStart(group.bookings)
  expect(customerOf(first)).toBe("Alva Lindqvist")
  return { alva: first, elias: second }
}

const save = (dialog: Locator) => dialog.getByRole("button", { name: "Save changes" })
const patchOf = (group: Group) => `booking-groups/${group.id}`

async function addTemporaryBooking(api: Parameters<typeof seedIds>[0], group: Group) {
  const ids = await seedIds(api)
  return api.post<GroupBooking>("bookings", {
    booking_group_id: group.id,
    service_id: ids.haircut,
    location_id: ids.stockholm,
    resource_id: ids.roomA,
    starts_at: "2026-11-03T12:00:00+01:00",
    ends_at: "2026-11-03T12:45:00+01:00",
    is_temporary: true,
  })
}

test.describe("edit booking group", () => {
  test("lists the bookings sorted by start, as existing rows", async ({ page, api, ui }) => {
    const seed = await seedGroup(api)
    const { elias } = rows(seed)
    // Elias moves to 09:00, so he comes first although the API lists him second.
    await api.patch(`bookings/${elias.id}`, {
      starts_at: "2026-11-03T09:00:00+01:00",
      ends_at: "2026-11-03T09:45:00+01:00",
    })
    const group = await getGroup(api, seed.id)
    expect(customerOf(group.bookings[0])).toBe("Alva Lindqvist")
    const dialog = await openEdit(page, ui, group, "Edit bookings")

    await expect(dialog.getByRole("group", { name: /^Booking \d+$/ })).toHaveCount(2)
    const first = bookingRow(dialog, 1)
    const f = rowFields(first)
    await expect(f.resource).toHaveText("Ben")
    await expect(rowFields(bookingRow(dialog, 2)).resource).toHaveText("Anna")
    await expect(f.service).toHaveText("Haircut")
    await expect(f.location).toHaveText("Stockholm Studio")
    await expect(f.starts).toHaveValue("2026-11-03T09:00")
    await expect(f.ends).toHaveValue("2026-11-03T09:45")
    await expect(f.price).toHaveValue("450.000")
    await expect(f.price).toHaveAttribute("placeholder", "No price")
    await expect(first.getByText(`${short(elias.id)}…`)).toBeVisible()
    await expect(first.getByText("Confirmed", { exact: true })).toBeVisible()
    await expect(first.getByText("New", { exact: true })).toHaveCount(0)
    await expect(first.getByText("Modified", { exact: true })).toHaveCount(0)
    const open = first.getByRole("link", { name: "Open" })
    await expect(open).toHaveAttribute("href", `/bookings/${elias.id}`)
    await expect(open).toHaveAttribute("target", "_blank")
    // An existing booking's resource can be changed but not cleared.
    await expect(first.getByRole("button", { name: "Clear selection" })).toHaveCount(0)
    await expect(f.canceled).not.toBeChecked()
    await expect(dialog.getByRole("switch", { name: "Ignore cancelation threshold" })).toHaveCount(0)
  })

  test("marks a changed row as Modified until it matches again", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    const dialog = await openEdit(page, ui, group)
    const first = bookingRow(dialog, 1)
    const price = rowFields(first).price

    await price.fill("500")
    await expect(first.getByText("Modified", { exact: true })).toBeVisible()
    await expect(bookingRow(dialog, 2).getByText("Modified", { exact: true })).toHaveCount(0)
    await price.fill("450")
    await expect(first.getByText("Modified", { exact: true })).toHaveCount(0)
  })

  test("sends unchanged rows as ids, changed rows with their changes and new rows without an id", async ({
    page,
    api,
    net,
    ui,
  }) => {
    const group = await seedGroup(api)
    const ids = await seedIds(api)
    const { alva, elias } = rows(group)
    const dialog = await openEdit(page, ui, group)

    // Moving the start keeps the booking's length.
    const first = rowFields(bookingRow(dialog, 1))
    await first.starts.fill("2026-11-03T11:00")
    await expect(first.ends).toHaveValue("2026-11-03T11:45")

    // A new row copies service, location and resource from the last row.
    await dialog.getByRole("button", { name: "Add booking" }).click()
    const third = bookingRow(dialog, 3)
    await expect(third.getByText("New", { exact: true })).toBeVisible()
    await expect(rowFields(third).resource).toHaveText("Ben")
    await expect(rowFields(third).price).toHaveAttribute("placeholder", "Calculated by Hapio")
    await expect(rowFields(third).canceled).toHaveCount(0)
    await rowFields(third).starts.fill("2026-11-03T12:00")
    await expect(rowFields(third).ends).toHaveValue("2026-11-03T12:45")

    const request = net.waitFor("PATCH", patchOf(group))
    await save(dialog).click()
    expect((await request).body).toEqual({
      bookings: [
        { id: alva.id, starts_at: "2026-11-03T11:00:00+01:00", ends_at: "2026-11-03T11:45:00+01:00" },
        { id: elias.id },
        {
          service_id: ids.haircut,
          location_id: ids.stockholm,
          resource_id: ids.ben,
          starts_at: "2026-11-03T12:00:00+01:00",
          ends_at: "2026-11-03T12:45:00+01:00",
        },
      ],
    })
    await expectToast(page, "Booking group updated", { type: "success" })
    await expect(dialog).toBeHidden()
    await ui.expectRowCount(3)
    await expect(detailValue(page, "Span")).toHaveText("Tue 3 Nov 2026, 10:00–12:45")

    const saved = await getGroup(api, group.id)
    expect(saved.bookings).toHaveLength(3)
    expect(saved.bookings.find((b) => b.id === alva.id)?.starts_at).toBe("2026-11-03T11:00:00+01:00")
  })

  test("moving a booking to another location keeps its wall time there", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const ids = await seedIds(api)
    const { alva, elias } = rows(group)
    await allowDateSubclasses(page)
    const dialog = await openEdit(page, ui, group)

    const first = bookingRow(dialog, 1)
    await ui.pick(rowFields(first).location, "New York Loft")
    await expect(first.getByText("America/New_York", { exact: true })).toHaveCount(2)
    await expect(rowFields(first).starts).toHaveValue("2026-11-03T10:00")
    await expect(rowFields(first).ends).toHaveValue("2026-11-03T10:45")
    await expect(first.getByText("Modified", { exact: true })).toBeVisible()

    const request = net.waitFor("PATCH", patchOf(group))
    await save(dialog).click()
    expect((await request).body).toEqual({
      bookings: [
        {
          id: alva.id,
          location_id: ids.newYork,
          starts_at: "2026-11-03T10:00:00-05:00",
          ends_at: "2026-11-03T10:45:00-05:00",
        },
        { id: elias.id },
      ],
    })
    await expectToast(page, "Booking group updated")
  })

  test("a metadata-only edit leaves the bookings out", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const dialog = await openEdit(page, ui, group)
    const metadata = dialog.getByRole("textbox", { name: "Metadata", exact: true })
    await expect(metadata).toHaveValue(JSON.stringify(group.metadata, null, 2))

    await metadata.fill('{"party":"Lindqvist","note":"Twins"}')
    const request = net.waitFor("PATCH", patchOf(group))
    await save(dialog).click()
    expect((await request).body).toEqual({ metadata: { party: "Lindqvist", note: "Twins" } })
    await expectToast(page, "Booking group updated")
    await expect(dialog).toBeHidden()
    const saved = await getGroup(api, group.id)
    expect(saved.metadata).toEqual({ party: "Lindqvist", note: "Twins" })
    expect(saved.bookings).toHaveLength(2)
  })

  test("saving without changes sends nothing", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const dialog = await openEdit(page, ui, group)

    // A change that is undone again doesn't count.
    await rowFields(bookingRow(dialog, 2)).price.fill("1")
    await rowFields(bookingRow(dialog, 2)).price.fill("450.000")
    await save(dialog).click()
    await expectToast(page, "No changes to save", { type: "info" })
    await expect(dialog).toBeHidden()
    expect(net.find("PATCH", patchOf(group))).toEqual([])
  })

  test("removing an existing row warns that it will be deleted, and Keep brings it back", async ({
    page,
    api,
    net,
    ui,
  }) => {
    const group = await seedGroup(api)
    const { elias } = rows(group)
    const dialog = await openEdit(page, ui, group)

    await dialog.getByRole("button", { name: "Remove booking 2" }).click()
    await expect(dialog.getByRole("group", { name: /^Booking \d+$/ })).toHaveCount(1)
    const warning = dialog.getByRole("alert").filter({ hasText: "1 booking will be deleted when you save" })
    await expect(warning).toContainText("Bookings removed from this list are deleted permanently")
    await expect(warning).toContainText(`Haircut, Tue 3 Nov 2026, 10:00–10:45 (${short(elias.id)})`)
    await expect(dialog.getByRole("button", { name: "Remove booking 1" })).toBeDisabled()

    await warning.getByRole("button", { name: "Keep" }).click()
    await expect(warning).toBeHidden()
    await expect(rowFields(bookingRow(dialog, 2)).resource).toHaveText("Ben")
    await save(dialog).click()
    await expectToast(page, "No changes to save")
    expect(net.find("PATCH", patchOf(group))).toEqual([])
  })

  test("saving a removal asks first, then sends the remaining rows", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const { alva, elias } = rows(group)
    const dialog = await openEdit(page, ui, group)

    await dialog.getByRole("button", { name: "Remove booking 1" }).click()
    await save(dialog).click()
    const confirm = ui.alertDialog("Delete 1 booking?")
    await expect(confirm).toContainText("Saving permanently deletes these bookings. This can't be undone.")
    await expect(confirm).toContainText(`Haircut, Tue 3 Nov 2026, 10:00–10:45 (${short(alva.id)})`)
    expect(net.find("PATCH", patchOf(group))).toEqual([])

    const request = net.waitFor("PATCH", patchOf(group))
    await ui.confirm("Delete 1 booking?", "Delete and save")
    expect((await request).body).toEqual({ bookings: [{ id: elias.id }] })
    await expectToast(page, "Booking group updated", { type: "success" })
    await expect(dialog).toBeHidden()
    await ui.expectRowCount(1)

    await expect(api.get(`bookings/${alva.id}`)).rejects.toMatchObject({ status: 404 })
    expect((await getGroup(api, group.id)).bookings.map((b) => b.id)).toEqual([elias.id])
  })

  test("cancelling the delete confirmation keeps the dialog and sends nothing", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const dialog = await openEdit(page, ui, group)

    await dialog.getByRole("button", { name: "Remove booking 1" }).click()
    await save(dialog).click()
    await ui.dismiss("Delete 1 booking?")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("1 booking will be deleted when you save")).toBeVisible()
    expect(net.find("PATCH", patchOf(group))).toEqual([])
  })

  test("removing several bookings counts them all", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const ids = await seedIds(api)
    const dialog = await openEdit(page, ui, group)

    await dialog.getByRole("button", { name: "Add booking" }).click()
    await rowFields(bookingRow(dialog, 3)).starts.fill("2026-11-04T10:00")
    await dialog.getByRole("button", { name: "Remove booking 1" }).click()
    await dialog.getByRole("button", { name: "Remove booking 1" }).click()
    await expect(dialog.getByText("2 bookings will be deleted when you save")).toBeVisible()

    await save(dialog).click()
    const request = net.waitFor("PATCH", patchOf(group))
    await ui.confirm("Delete 2 bookings?", "Delete and save")
    expect((await request).body).toEqual({
      bookings: [
        {
          service_id: ids.haircut,
          location_id: ids.stockholm,
          resource_id: ids.ben,
          starts_at: "2026-11-04T10:00:00+01:00",
          ends_at: "2026-11-04T10:45:00+01:00",
        },
      ],
    })
    await expectToast(page, "Booking group updated")
    const saved = await getGroup(api, group.id)
    expect(saved.bookings).toHaveLength(1)
    expect(saved.bookings[0].starts_at).toBe("2026-11-04T10:00:00+01:00")
  })

  test("Temporary can only be switched off, and only on temporary bookings", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const { alva, elias } = rows(group)
    const temporary = await addTemporaryBooking(api, group)
    const dialog = await openEdit(page, ui, await getGroup(api, group.id))

    await expect(rowFields(bookingRow(dialog, 1)).temporary).toBeDisabled()
    await expect(rowFields(bookingRow(dialog, 2)).temporary).toBeDisabled()
    const third = bookingRow(dialog, 3)
    await expect(third.getByText("Temporary", { exact: true }).first()).toBeVisible()
    await expect(rowFields(third).temporary).toBeEnabled()
    await expect(rowFields(third).temporary).toBeChecked()

    await rowFields(third).temporary.click()
    await expect(third.getByText("Modified", { exact: true })).toBeVisible()
    const request = net.waitFor("PATCH", patchOf(group))
    await save(dialog).click()
    expect((await request).body).toEqual({
      bookings: [{ id: alva.id }, { id: elias.id }, { id: temporary.id, is_temporary: false }],
    })
    await expectToast(page, "Booking group updated")
    expect((await api.get<GroupBooking>(`bookings/${temporary.id}`)).is_temporary).toBe(false)
  })

  test("Canceled sends ignore_cancelation_threshold only on the row being canceled", async ({
    page,
    api,
    net,
    ui,
  }) => {
    const group = await seedGroup(api)
    const { alva, elias } = rows(group)
    const dialog = await openEdit(page, ui, group)

    await dialog.getByRole("button", { name: /^Override rules/ }).click()
    await dialog.getByRole("switch", { name: "Ignore cancelation threshold", exact: true }).click()
    await dialog.getByRole("switch", { name: "Ignore fully booked", exact: true }).click()
    await rowFields(bookingRow(dialog, 1)).canceled.click()
    await rowFields(bookingRow(dialog, 2)).price.fill("500")

    const request = net.waitFor("PATCH", patchOf(group))
    await save(dialog).click()
    expect((await request).body).toEqual({
      bookings: [
        { id: alva.id, is_canceled: true, ignore_fully_booked: true, ignore_cancelation_threshold: true },
        { id: elias.id, price: "500.000", ignore_fully_booked: true },
      ],
    })
    await expectToast(page, "Booking group updated")
    await expect(detailValue(page, "Status")).toHaveText("1 confirmed · 1 canceled")
  })

  test("restoring a canceled booking doesn't send the threshold flag", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const { alva, elias } = rows(group)
    await api.patch(`bookings/${elias.id}`, { is_canceled: true })
    const dialog = await openEdit(page, ui, group)

    const second = bookingRow(dialog, 2)
    await expect(second.getByText("Canceled", { exact: true }).first()).toBeVisible()
    await expect(rowFields(second).canceled).toBeChecked()
    await dialog.getByRole("button", { name: /^Override rules/ }).click()
    await dialog.getByRole("switch", { name: "Ignore cancelation threshold", exact: true }).click()
    await rowFields(second).canceled.click()

    const request = net.waitFor("PATCH", patchOf(group))
    await save(dialog).click()
    expect((await request).body).toEqual({ bookings: [{ id: alva.id }, { id: elias.id, is_canceled: false }] })
    await expectToast(page, "Booking group updated")
    await expect(detailValue(page, "Status")).toHaveText("2 confirmed")
  })

  test("Hapio's per-booking errors show on the rejected row", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    await net.fail(patchOf(group), {
      method: "PATCH",
      status: 422,
      body: {
        message: "The given data was invalid.",
        errors: { "bookings.1.ends_at": ["The ends at must be a date after starts at."] },
        messages: { "bookings.1": "Ben is fully booked at this time." },
      },
    })
    const dialog = await openEdit(page, ui, group)
    await rowFields(bookingRow(dialog, 2)).price.fill("500")
    await save(dialog).click()

    const second = bookingRow(dialog, 2)
    await expect(second.getByText("The ends at must be a date after starts at.")).toBeVisible()
    await expect(rowFields(second).ends).toHaveAttribute("aria-invalid", "true")
    await expect(rowFields(second).alert).toContainText("Ben is fully booked at this time.")
    await expect(bookingRow(dialog, 1).getByRole("alert")).toHaveCount(0)
    await expect(dialog.getByRole("alert").filter({ hasText: "Hapio rejected the request" })).toContainText(
      "Hapio rejected booking 2. See the details on that row."
    )
    await expect(dialog).toBeVisible()
    await expect(save(dialog)).toBeEnabled()
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)

    // Adding a row shifts nothing, but the row alert is dropped as stale.
    await dialog.getByRole("button", { name: "Add booking" }).click()
    await expect(rowFields(second).alert).toHaveCount(0)
  })

  test("other errors are toasted and keep the dialog open", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    await net.fail(patchOf(group), { method: "PATCH", status: 500, body: { message: "Server Error" } })
    const dialog = await openEdit(page, ui, group)
    await rowFields(bookingRow(dialog, 1)).price.fill("500")
    await save(dialog).click()

    // The modal covers the toast's close button.
    await expectToast(page, "Server Error", { type: "error", close: false })
    await expect(dialog).toBeVisible()
    await expect(rowFields(bookingRow(dialog, 1)).price).toHaveValue("500.000")
  })

  test("keeps in-progress edits when the group is refetched in the background", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const { alva, elias } = rows(group)
    const dialog = await openEdit(page, ui, group)
    await rowFields(bookingRow(dialog, 1)).price.fill("500")
    const metadata = dialog.getByRole("textbox", { name: "Metadata", exact: true })
    await metadata.fill('{"party":"Typed here"}')

    // Someone else edits the group; the data goes stale and the browser reconnects.
    await api.patch(patchOf(group), { metadata: { party: "Changed elsewhere" } })
    const refetch = net.waitFor("GET", patchOf(group))
    await page.clock.fastForward(31_000)
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"))
      window.dispatchEvent(new Event("online"))
    })
    await refetch
    await expect(metadataCardPre(page)).toContainText("Changed elsewhere")

    await expect(rowFields(bookingRow(dialog, 1)).price).toHaveValue("500.000")
    await expect(metadata).toHaveValue('{"party":"Typed here"}')
    const request = net.waitFor("PATCH", patchOf(group))
    await save(dialog).click()
    expect((await request).body).toEqual({
      bookings: [{ id: alva.id, price: "500.000" }, { id: elias.id }],
      metadata: { party: "Typed here" },
    })
    await expectToast(page, "Booking group updated")
  })

  test("an empty group's metadata can be edited without adding a booking", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    for (const booking of group.bookings) await api.delete(`bookings/${booking.id}`)
    const dialog = await openEdit(page, ui, group)
    await expect(dialog.getByRole("group", { name: /^Booking \d+$/ })).toHaveCount(0)

    await dialog.getByRole("textbox", { name: "Metadata", exact: true }).fill('{"party":"Nobody"}')
    const request = net.waitFor("PATCH", patchOf(group))
    await save(dialog).click()
    expect((await request).body).toEqual({ metadata: { party: "Nobody" } })
    await expectToast(page, "Booking group updated")
    await expect(dialog).toBeHidden()
    await expect(dialog.getByText("Add at least one booking.")).toHaveCount(0)
    expect(net.find("PATCH", patchOf(group))).toHaveLength(1)
    expect((await getGroup(api, group.id)).metadata).toEqual({ party: "Nobody" })
  })

  test("a booking added to an empty group can be removed again", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    for (const booking of group.bookings) await api.delete(`bookings/${booking.id}`)
    const dialog = await openEdit(page, ui, group)
    await expect(dialog.getByRole("group", { name: /^Booking \d+$/ })).toHaveCount(0)

    await dialog.getByRole("button", { name: "Add booking" }).click()
    const row = bookingRow(dialog, 1)
    await expect(row.getByText("New", { exact: true })).toBeVisible()
    await row.getByRole("button", { name: "Remove booking 1" }).click()
    await expect(dialog.getByRole("group", { name: /^Booking \d+$/ })).toHaveCount(0)

    // Nothing left to save.
    await save(dialog).click()
    await expectToast(page, "No changes to save", { type: "info" })
    await expect(dialog).toBeHidden()
    expect(net.mutations()).toEqual([])
  })

  test("Cancel and Escape close the dialog without saving", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    let dialog = await openEdit(page, ui, group)
    await rowFields(bookingRow(dialog, 1)).price.fill("500")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(dialog).toBeHidden()

    // Reopening starts from the group again.
    await ui.main().getByRole("button", { name: "Edit", exact: true }).click()
    dialog = ui.dialog(`Edit booking group ${short(group.id)}`)
    await expect(rowFields(bookingRow(dialog, 1)).price).toHaveValue("450.000")
    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    expect(net.mutations()).toEqual([])
  })
})

/** The detail page's "Group metadata" card. It sits behind the modal (aria-hidden), so no role query. */
function metadataCardPre(page: Page) {
  return page
    .locator("main")
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]').getByText("Group metadata", { exact: true }) })
    .locator("pre")
}
