import type { Locator, Page } from "@playwright/test"

import type { HapioApi } from "../fixtures/hapio-api"
import { expectNoToast, expectToast } from "../helpers/toasts"
import { expect, seedBooking, shortId, test, type ApiBooking } from "./_helpers"

/** The "Booking group" value on a booking's detail page. */
function groupDetail(page: Page): Locator {
  return page
    .locator("dl > div")
    .filter({ has: page.locator("dt").filter({ hasText: /^Booking group$/ }) })
    .locator("dd")
}

/** A second booking group (one new booking at Stockholm), created through the API. */
async function createOtherGroup(api: HapioApi) {
  const [service_id, location_id, resource_id] = await Promise.all([
    api.idOf("services", "Haircut"),
    api.idOf("locations", "Stockholm Studio"),
    api.idOf("resources", "Ben"),
  ])
  return api.post<{ id: string; bookings: ApiBooking[] }>("booking-groups", {
    metadata: { party: "Nyberg" },
    bookings: [
      { service_id, location_id, resource_id, starts_at: "2026-11-04T10:00:00+01:00", ends_at: "2026-11-04T10:45:00+01:00" },
    ],
  })
}

test.describe("add a booking to a group", () => {
  test("validates the group id before sending", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    await page.goto(`/bookings/${erik.id}`)
    await expect(groupDetail(page)).toContainText("Not in a group")
    await groupDetail(page).getByRole("button", { name: "Add to group" }).click()
    const dialog = ui.dialog("Add to a booking group")
    await expect(dialog).toContainText("The booking keeps its times and status; only its group changes.")
    const input = dialog.getByLabel("Booking group", { exact: true })
    const submit = dialog.getByRole("button", { name: "Add to group" })

    await submit.click()
    await expect(dialog.getByText("Enter or pick a booking group.")).toBeVisible()
    await expect(input).toHaveAttribute("aria-invalid", "true")

    await input.fill("not-a-uuid")
    // Typing clears the error until the next submit.
    await expect(dialog.getByText("Enter or pick a booking group.")).toBeHidden()
    await submit.click()
    await expect(dialog.getByText("Not a valid booking group ID.")).toBeVisible()
    expect(net.mutations()).toEqual([])

    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    // Reopening starts fresh.
    await groupDetail(page).getByRole("button", { name: "Add to group" }).click()
    await expect(input).toHaveValue("")
    await expect(dialog.getByText("Not a valid booking group ID.")).toBeHidden()
  })

  test("pick a recent group and add the booking", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const [group] = await api.list<{ id: string }>("booking-groups")
    await page.goto(`/bookings/${erik.id}`)
    await groupDetail(page).getByRole("button", { name: "Add to group" }).click()
    const dialog = ui.dialog("Add to a booking group")
    await dialog.getByRole("button", { name: "Pick a recent booking group" }).click()
    await page.getByRole("option", { name: /2 bookings · 3 Nov 2026 · Haircut/ }).click()
    await expect(dialog.getByLabel("Booking group", { exact: true })).toHaveValue(group.id)

    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await dialog.getByRole("button", { name: "Add to group" }).click()
    expect((await request).body).toEqual({ booking_group_id: group.id })
    await expectToast(page, "Booking added to group", { type: "success" })
    await expect(dialog).toBeHidden()
    await expect(groupDetail(page).getByRole("link", { name: `${shortId(group.id)}…` })).toBeVisible()
    expect(((await api.get(`bookings/${erik.id}`)).booking_group as { id: string }).id).toBe(group.id)
  })

  test("a pasted group id works too", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const [group] = await api.list<{ id: string }>("booking-groups")
    await page.goto(`/bookings/${erik.id}`)
    await groupDetail(page).getByRole("button", { name: "Add to group" }).click()
    const dialog = ui.dialog("Add to a booking group")
    await dialog.getByLabel("Booking group", { exact: true }).fill(`  ${group.id}  `)
    const request = net.waitFor("PATCH", `bookings/${erik.id}`)
    await dialog.getByRole("button", { name: "Add to group" }).click()
    expect((await request).body).toEqual({ booking_group_id: group.id })
    await expectToast(page, "Booking added to group")
  })

  test("a server rejection is shown in the dialog, not as a toast", async ({ page, ui, api, net }) => {
    const erik = await seedBooking(api, "Erik Lund")
    const [group] = await api.list<{ id: string }>("booking-groups")
    const message = "The selected booking group id is invalid."
    await net.fail(`bookings/${erik.id}`, {
      method: "PATCH",
      status: 422,
      body: { message, errors: { booking_group_id: [message], is_canceled: ["The booking is locked."] } },
    })
    await page.goto(`/bookings/${erik.id}`)
    await groupDetail(page).getByRole("button", { name: "Add to group" }).click()
    const dialog = ui.dialog("Add to a booking group")
    const input = dialog.getByLabel("Booking group", { exact: true })
    await input.fill(group.id)
    await dialog.getByRole("button", { name: "Add to group" }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(message)).toBeVisible()
    await expect(input).toHaveAttribute("aria-invalid", "true")
    // Messages for other fields go to the dialog's alert.
    await expect(dialog.getByRole("alert").filter({ hasText: "Hapio rejected the request" })).toContainText(
      "The booking is locked."
    )
    await expectNoToast(page, message)

    // Closing clears them.
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await groupDetail(page).getByRole("button", { name: "Add to group" }).click()
    await expect(dialog.getByText(message)).toBeHidden()
    await expect(dialog.getByText("Hapio rejected the request")).toBeHidden()
  })
})

test.describe("move a booking to another group", () => {
  test("the picker leaves out the current group; the same id is refused", async ({ page, ui, api, net }) => {
    const alva = await seedBooking(api, "Alva Lindqvist")
    const other = await createOtherGroup(api)
    await page.goto(`/bookings/${alva.id}`)
    await expect(groupDetail(page)).toContainText("party, note")
    await groupDetail(page).getByRole("button", { name: "Move", exact: true }).click()
    const dialog = ui.dialog("Move to another group")
    await dialog.getByRole("button", { name: "Pick a recent booking group" }).click()
    const options = page.getByRole("option")
    await expect(options).toHaveCount(1)
    await expect(options.first()).toContainText(shortId(other.id))
    await expect(options.first()).toContainText("1 booking · 4 Nov 2026 · Haircut")
    await page.keyboard.press("Escape")

    await dialog.getByLabel("Booking group", { exact: true }).fill(alva.booking_group!.id)
    await dialog.getByRole("button", { name: "Move booking" }).click()
    await expect(dialog.getByText("The booking is already in this group.")).toBeVisible()
    expect(net.mutations()).toEqual([])
  })

  test("moves the booking", async ({ page, ui, api, net }) => {
    const alva = await seedBooking(api, "Alva Lindqvist")
    const other = await createOtherGroup(api)
    await page.goto(`/bookings/${alva.id}`)
    await groupDetail(page).getByRole("button", { name: "Move", exact: true }).click()
    const dialog = ui.dialog("Move to another group")
    await dialog.getByRole("button", { name: "Pick a recent booking group" }).click()
    await page.getByRole("option", { name: /1 booking · 4 Nov 2026/ }).click()
    const request = net.waitFor("PATCH", `bookings/${alva.id}`)
    await dialog.getByRole("button", { name: "Move booking" }).click()
    expect((await request).body).toEqual({ booking_group_id: other.id })
    await expectToast(page, "Booking moved to group", { type: "success" })
    await expect(groupDetail(page).getByRole("link", { name: `${shortId(other.id)}…` })).toBeVisible()
  })

  test("with no other group, the picker says so", async ({ page, ui, api }) => {
    const alva = await seedBooking(api, "Alva Lindqvist")
    await page.goto(`/bookings/${alva.id}`)
    await groupDetail(page).getByRole("button", { name: "Move", exact: true }).click()
    const dialog = ui.dialog("Move to another group")
    await dialog.getByRole("button", { name: "Pick a recent booking group" }).click()
    await expect(page.getByText("No booking groups found.")).toBeVisible()
  })
})

test.describe("remove a booking from its group", () => {
  test("asks first, then removes", async ({ page, ui, api, net }) => {
    const alva = await seedBooking(api, "Alva Lindqvist")
    const groupId = alva.booking_group!.id
    await page.goto(`/bookings/${alva.id}`)
    await groupDetail(page).getByRole("button", { name: "Remove", exact: true }).click()
    const dialog = ui.alertDialog("Remove from group?")
    await expect(dialog).toContainText(`The booking is kept but no longer belongs to group ${shortId(groupId)}.`)
    await ui.dismiss("Remove from group?")
    expect(net.mutations()).toEqual([])

    await groupDetail(page).getByRole("button", { name: "Remove", exact: true }).click()
    const request = net.waitFor("PATCH", `bookings/${alva.id}`)
    await ui.confirm("Remove from group?", "Remove from group")
    expect((await request).body).toEqual({ booking_group_id: null })
    await expectToast(page, "Booking removed from group", { type: "success" })
    await expect(groupDetail(page)).toContainText("Not in a group")
    expect((await api.get(`bookings/${alva.id}`)).booking_group).toBeNull()
    // The booking itself is kept.
    await expect(ui.heading("Haircut")).toBeVisible()
  })
})
