import type { Page } from "@playwright/test"

import { ApiError } from "../fixtures/hapio-api"
import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { recordAppearances } from "../helpers/flash"
import { expectToast } from "../helpers/toasts"
import {
  byStart,
  customerOf,
  detailValue,
  emptyTheGroup,
  formatStamp,
  getGroup,
  seedGroup,
  seedIds,
  short,
  type Group,
  type GroupBooking,
} from "./_helpers"

/** Seed group bookings by customer: Alva is with Anna, Elias with Ben. */
function lindqvists(group: Group) {
  const find = (name: string) => group.bookings.find((b) => customerOf(b) === name)!
  return { alva: find("Alva Lindqvist"), elias: find("Elias Lindqvist") }
}

async function openGroup(page: Page, group: Group) {
  await page.goto(`/booking-groups/${group.id}`)
  await expect(page.getByRole("heading", { level: 1, name: `Booking group ${short(group.id)}` })).toBeVisible()
}

const actionsFor = (page: Page, booking: GroupBooking) =>
  page.getByRole("button", { name: `Actions for booking ${short(booking.id)}` })

async function bookingAction(page: Page, booking: GroupBooking, item: string) {
  await actionsFor(page, booking).click()
  await page.getByRole("menuitem", { name: item, exact: true }).click()
}

const metadataCard = (page: Page, title: string) =>
  page
    .getByRole("main")
    .locator('[data-slot="card"]')
    .filter({ has: page.locator('[data-slot="card-title"]').getByText(title, { exact: true }) })

test.describe("booking group detail", () => {
  test("summarises the group", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await openGroup(page, group)

    await expect(ui.main().getByText("2 bookings", { exact: true })).toBeVisible()
    await expect(ui.main().getByText(group.id, { exact: true })).toBeVisible()
    await expect(detailValue(page, "Span")).toHaveText("Tue 3 Nov 2026, 10:00–10:45")
    await expect(detailValue(page, "Status")).toHaveText("2 confirmed")
    await expect(detailValue(page, "Services")).toHaveText("Haircut")
    await expect(detailValue(page, "Locations")).toHaveText(SEED.locations.stockholm.name)
    await expect(detailValue(page, "Created")).toHaveText(formatStamp(group.created_at))
    await expect(detailValue(page, "Updated")).toHaveText(formatStamp(group.updated_at))
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText(`Group ${short(group.id)}`)
  })

  test("lists the group's bookings with links to each part", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    const ids = await seedIds(api)
    const { alva, elias } = lindqvists(group)
    await openGroup(page, group)

    await ui.expectRowCount(2)
    for (const [booking, resource, resourceId] of [
      [alva, "Anna", ids.anna],
      [elias, "Ben", ids.ben],
    ] as const) {
      const row = ui.main().getByRole("row").filter({ has: actionsFor(page, booking) })
      const cells = row.getByRole("cell")
      await expect(cells.nth(0)).toContainText("Tue 3 Nov 2026")
      await expect(cells.nth(0)).toContainText("10:00–10:45")
      await expect(cells.nth(1).getByRole("link", { name: "Haircut" })).toHaveAttribute("href", `/services/${ids.haircut}`)
      await expect(cells.nth(2).getByRole("link", { name: resource })).toHaveAttribute("href", `/resources/${resourceId}`)
      await expect(cells.nth(3).getByRole("link", { name: SEED.locations.stockholm.name })).toHaveAttribute(
        "href",
        `/locations/${ids.stockholm}`
      )
      await expect(cells.nth(4)).toHaveText("Confirmed")
      await expect(cells.nth(5)).toHaveText("450.00")
    }
  })

  test("shows each booking in its own location's time", async ({ page, api, ui }) => {
    const ids = await seedIds(api)
    const group = await api.post<Group>("booking-groups", {
      bookings: [
        { service_id: ids.haircut, location_id: ids.stockholm, resource_id: ids.ben, starts_at: "2026-11-03T10:00:00+01:00", ends_at: "2026-11-03T10:45:00+01:00" },
        { service_id: ids.haircut, location_id: ids.newYork, resource_id: ids.anna, starts_at: "2026-11-03T08:00:00-05:00", ends_at: "2026-11-03T08:45:00-05:00" },
      ],
    })
    await openGroup(page, group)
    await expect(detailValue(page, "Locations")).toHaveText(`${SEED.locations.stockholm.name}, ${SEED.locations.newYork.name}`)
    const newYork = ui.main().getByRole("row").filter({ hasText: SEED.locations.newYork.name })
    await expect(newYork.getByRole("cell").nth(0)).toContainText("08:00–08:45")
    const stockholm = ui.main().getByRole("row").filter({ hasText: SEED.locations.stockholm.name }).last()
    await expect(stockholm.getByRole("cell").nth(0)).toContainText("10:00–10:45")
  })

  test("the span of a group across time zones doesn't end before it starts", async ({ page, api }) => {
    const ids = await seedIds(api)
    // 09:00–09:45 UTC in Stockholm, then 13:00–13:45 UTC in New York.
    const group = await api.post<Group>("booking-groups", {
      bookings: [
        { service_id: ids.haircut, location_id: ids.stockholm, resource_id: ids.ben, starts_at: "2026-11-03T10:00:00+01:00", ends_at: "2026-11-03T10:45:00+01:00" },
        { service_id: ids.haircut, location_id: ids.newYork, resource_id: ids.anna, starts_at: "2026-11-03T08:00:00-05:00", ends_at: "2026-11-03T08:45:00-05:00" },
      ],
    })
    await openGroup(page, group)
    await expect(detailValue(page, "Locations")).toContainText(SEED.locations.newYork.name)
    // Earliest start to latest end by instant, each in its own booking's local time.
    await expect(detailValue(page, "Span")).toHaveText("Tue 3 Nov 2026, 10:00 (UTC+01:00) → 08:45 (UTC-05:00)")
  })

  test("shows the group metadata and protected metadata", async ({ page, api }) => {
    const group = await seedGroup(api)
    await openGroup(page, group)

    await expect(metadataCard(page, "Group metadata").locator("pre")).toHaveText(
      JSON.stringify(SEED.group.metadata, null, 2)
    )
    await expect(metadataCard(page, "Group protected metadata").locator("pre")).toHaveText("null")
    await expect(metadataCard(page, "Group protected metadata")).not.toContainText("Not returned")
  })

  test("offers the actions that fit each booking's status", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    const ids = await seedIds(api)
    const { alva, elias } = lindqvists(group)
    await api.patch(`bookings/${elias.id}`, { is_canceled: true })
    const temporary = await api.post<GroupBooking>("bookings", {
      booking_group_id: group.id,
      service_id: ids.haircut,
      location_id: ids.stockholm,
      resource_id: ids.roomA,
      starts_at: "2026-11-03T12:00:00+01:00",
      ends_at: "2026-11-03T12:45:00+01:00",
      is_temporary: true,
    })
    await openGroup(page, group)
    await expect(detailValue(page, "Status")).toHaveText("1 confirmed · 1 temporary · 1 canceled")

    const menu = page.getByRole("menu")
    for (const [booking, items] of [
      [alva, ["View", "Cancel booking", "Remove from group", "Delete"]],
      [temporary, ["View", "Finalize", "Cancel booking", "Remove from group", "Delete"]],
      [elias, ["View", "Restore", "Remove from group", "Delete"]],
    ] as const) {
      await actionsFor(page, booking).click()
      await expect(menu.getByRole("menuitem")).toHaveText([...items])
      await page.keyboard.press("Escape")
      await expect(menu).toBeHidden()
    }
    await ui.expectRowCount(3)
  })

  test("Finalize confirms a temporary booking", async ({ page, api, net }) => {
    const group = await seedGroup(api)
    const ids = await seedIds(api)
    const temporary = await api.post<GroupBooking>("bookings", {
      booking_group_id: group.id,
      service_id: ids.haircut,
      location_id: ids.stockholm,
      resource_id: ids.roomA,
      starts_at: "2026-11-03T12:00:00+01:00",
      ends_at: "2026-11-03T12:45:00+01:00",
      is_temporary: true,
    })
    await openGroup(page, group)
    await expect(detailValue(page, "Status")).toHaveText("2 confirmed · 1 temporary")

    const request = net.waitFor("PATCH", `bookings/${temporary.id}`)
    await bookingAction(page, temporary, "Finalize")
    expect((await request).body).toEqual({ is_temporary: false })
    await expectToast(page, "Booking finalized", { type: "success" })
    await expect(detailValue(page, "Status")).toHaveText("3 confirmed")
    expect((await api.get<GroupBooking>(`bookings/${temporary.id}`)).is_temporary).toBe(false)
  })

  test("Cancel booking cancels it, optionally ignoring the threshold, and Restore brings it back", async ({
    page,
    api,
    net,
    ui,
  }) => {
    const group = await seedGroup(api)
    const { alva } = lindqvists(group)
    await openGroup(page, group)

    await bookingAction(page, alva, "Cancel booking")
    const dialog = ui.alertDialog("Cancel this booking?")
    await expect(dialog).toContainText("Haircut, Tue 3 Nov 2026, 10:00–10:45.")
    await dialog.getByRole("checkbox", { name: "Ignore cancelation threshold" }).check()
    const cancel = net.waitFor("PATCH", `bookings/${alva.id}`)
    await dialog.getByRole("button", { name: "Cancel booking" }).click()
    expect((await cancel).body).toEqual({ is_canceled: true, ignore_cancelation_threshold: true })
    await expect(dialog).toBeHidden()
    await expectToast(page, "Booking canceled", { type: "success" })
    await expect(detailValue(page, "Status")).toHaveText("1 confirmed · 1 canceled")
    const row = ui.main().getByRole("row").filter({ has: actionsFor(page, alva) })
    await expect(row.getByRole("cell").nth(4)).toHaveText("Canceled")

    const restore = net.waitFor("PATCH", `bookings/${alva.id}`)
    await bookingAction(page, alva, "Restore")
    expect((await restore).body).toEqual({ is_canceled: false })
    await expectToast(page, "Booking restored", { type: "success" })
    await expect(detailValue(page, "Status")).toHaveText("2 confirmed")
  })

  test("Keep booking closes the cancel dialog without a request", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const { alva } = lindqvists(group)
    await openGroup(page, group)

    await bookingAction(page, alva, "Cancel booking")
    await ui.dismiss("Cancel this booking?", "Keep booking")
    expect(net.mutations()).toEqual([])
    await expect(detailValue(page, "Status")).toHaveText("2 confirmed")
  })

  test("Remove from group keeps the booking outside the group", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const { elias } = lindqvists(group)
    await openGroup(page, group)

    await bookingAction(page, elias, "Remove from group")
    const dialog = ui.alertDialog("Remove from group?")
    await expect(dialog).toContainText(
      "Haircut, Tue 3 Nov 2026, 10:00–10:45. The booking is kept but no longer belongs to this group."
    )
    const request = net.waitFor("PATCH", `bookings/${elias.id}`)
    await ui.confirm("Remove from group?", "Remove from group")
    expect((await request).body).toEqual({ booking_group_id: null })
    await expectToast(page, "Booking removed from group", { type: "success" })

    await ui.expectRowCount(1)
    await expect(ui.main().getByText("1 booking", { exact: true })).toBeVisible()
    await expect(actionsFor(page, elias)).toHaveCount(0)
    const kept = await api.get<GroupBooking & { booking_group: unknown }>(`bookings/${elias.id}`)
    expect(kept.booking_group).toBeNull()
  })

  test("Delete removes a single booking permanently", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    const { alva } = lindqvists(group)
    await openGroup(page, group)

    await bookingAction(page, alva, "Delete")
    const dialog = ui.alertDialog("Delete this booking permanently?")
    await expect(dialog).toContainText("Haircut, Tue 3 Nov 2026, 10:00–10:45. This can't be undone.")
    const request = net.waitFor("DELETE", `bookings/${alva.id}`)
    await ui.confirm("Delete this booking permanently?", "Delete booking")
    await request
    await expectToast(page, "Booking deleted", { type: "success" })

    await ui.expectRowCount(1)
    await expect(detailValue(page, "Status")).toHaveText("1 confirmed")
    await expect(api.get(`bookings/${alva.id}`)).rejects.toMatchObject({ status: 404 })
  })

  test("View and row clicks open the booking", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    const { alva, elias } = lindqvists(group)
    await openGroup(page, group)

    await bookingAction(page, alva, "View")
    await expect(page).toHaveURL(`/bookings/${alva.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(`/booking-groups/${group.id}`)
    await ui.main().getByRole("row").filter({ has: actionsFor(page, elias) }).getByRole("cell").nth(4).click()
    await expect(page).toHaveURL(`/bookings/${elias.id}`)
  })

  test("Delete removes the group and its bookings, then returns to the list", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    await openGroup(page, group)

    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    const title = `Delete group ${short(group.id)}?`
    await expect(ui.alertDialog(title)).toContainText(
      "This permanently deletes the group and all 2 of its bookings. This can't be undone. To keep the bookings, remove them from the group first."
    )
    const request = net.waitFor("DELETE", `booking-groups/${group.id}`)
    await ui.confirm(title, "Delete group and bookings")
    await request
    await expect(page).toHaveURL("/booking-groups")
    await expectToast(page, "Booking group deleted", { type: "success" })
    await expect(ui.main().getByText("No booking groups", { exact: true })).toBeVisible()

    expect(await api.list("booking-groups")).toEqual([])
    for (const booking of group.bookings) {
      await expect(api.get(`bookings/${booking.id}`)).rejects.toBeInstanceOf(ApiError)
    }
  })

  test("deleting the group never refetches it or flashes a 404 for it", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    // Hold the list page's RSC payload (prefetch and navigation) back a little, so the
    // detail page is still mounted when the blanket refetch after the delete returns.
    await page.route(
      (url) => url.pathname === "/booking-groups",
      async (route) => {
        if (route.request().headers()["rsc"]) await new Promise((resolve) => setTimeout(resolve, 2_000))
        await route.fallback()
      }
    )
    await openGroup(page, group)
    const appeared = await recordAppearances(page, '[role="alert"]', "Request failed (404)")

    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    await ui.confirm(`Delete group ${short(group.id)}?`, "Delete group and bookings")
    await expect(page).toHaveURL("/booking-groups")
    await expect(ui.main().getByText("No booking groups", { exact: true })).toBeVisible()
    expect(await appeared(), "a 404 alert flashed").toBe(false)
    const calls = net.calls.filter((c) => c.path === `booking-groups/${group.id}`).map((c) => c.method)
    expect(calls.slice(calls.indexOf("DELETE")), "requests for the group from the delete on").toEqual(["DELETE"])
  })

  test("going back to a deleted group shows its 404, not the cached group", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await openGroup(page, group)
    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    await ui.confirm(`Delete group ${short(group.id)}?`, "Delete group and bookings")
    await expect(ui.main().getByText("No booking groups", { exact: true })).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(`/booking-groups/${group.id}`)
    await expect(ui.main().getByRole("alert").filter({ hasText: "Request failed (404)" })).toBeVisible()
    await expect(ui.heading(`Booking group ${short(group.id)}`)).toHaveCount(0)
  })

  test("the delete dialog counts a single booking", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await api.delete(`bookings/${lindqvists(group).elias.id}`)
    await openGroup(page, group)
    await expect(ui.main().getByText("1 booking", { exact: true })).toBeVisible()

    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    const dialog = ui.alertDialog(`Delete group ${short(group.id)}?`)
    await expect(dialog).toContainText("This permanently deletes the group and its 1 booking.")
    await expect(dialog.getByRole("button", { name: "Delete group and bookings" })).toBeVisible()
  })

  test("a failed group delete keeps the page and the dialog", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    await net.fail(`booking-groups/${group.id}`, { method: "DELETE", status: 500, body: { message: "Server Error" } })
    await openGroup(page, group)

    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    const dialog = ui.alertDialog(`Delete group ${short(group.id)}?`)
    await dialog.getByRole("button", { name: "Delete group and bookings" }).click()
    await expectToast(page, "Server Error", { type: "error", close: false })
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(`/booking-groups/${group.id}`)
    expect(await api.list("booking-groups")).toHaveLength(1)
  })

  test("Replace (PUT) starts from every booking, sorted by start", async ({ page, api, net, ui }) => {
    const seed = await seedGroup(api)
    // Move Elias earlier so the sorted order differs from the API's order.
    await api.patch(`bookings/${lindqvists(seed).elias.id}`, {
      starts_at: "2026-11-03T09:00:00+01:00",
      ends_at: "2026-11-03T09:45:00+01:00",
    })
    const group = await getGroup(api, seed.id)
    expect(customerOf(group.bookings[0])).toBe("Alva Lindqvist")
    await openGroup(page, group)

    await ui.tab("JSON")
    await expect(ui.main().locator("pre")).toContainText(`"id": "${group.id}"`)
    await ui.main().getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const textarea = dialog.getByRole("textbox", { name: "JSON body" })
    await expect(textarea).not.toHaveValue("")
    const body = JSON.parse(await textarea.inputValue())
    expect(body).toEqual({
      metadata: SEED.group.metadata,
      protected_metadata: null,
      bookings: byStart(group.bookings).map((b) => ({
        id: b.id,
        resource_id: b.resource?.id ?? null,
        service_id: b.service?.id ?? null,
        location_id: b.location?.id ?? null,
        price: b.price,
        metadata: b.metadata,
        protected_metadata: b.protected_metadata,
        is_temporary: b.is_temporary,
        is_canceled: b.is_canceled,
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        buffer_starts_at: b.buffer_starts_at,
        buffer_ends_at: b.buffer_ends_at,
      })),
    })
    expect(body.bookings.map((b: { id: string }) => b.id)).toEqual([
      lindqvists(group).elias.id,
      lindqvists(group).alva.id,
    ])

    const edited = { ...body, metadata: { party: "Lindqvist", note: "Moved to the morning" } }
    await textarea.fill(JSON.stringify(edited, null, 2))
    const request = net.waitFor("PUT", `booking-groups/${group.id}`)
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    expect((await request).body).toEqual(edited)
    await expectToast(page, "Booking group replaced", { type: "success" })
    await expect(dialog).toBeHidden()
    expect((await getGroup(api, group.id)).metadata).toEqual(edited.metadata)
  })

  test("Replace (PUT) shows invalid JSON and Hapio's errors in the dialog", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    await openGroup(page, group)
    await ui.tab("JSON")
    await ui.main().getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const textarea = dialog.getByRole("textbox", { name: "JSON body" })

    await textarea.fill("{")
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    await expect(textarea).toHaveAttribute("aria-invalid", "true")
    await expect(dialog.getByText(/in JSON at position/)).toBeVisible()
    expect(net.mutations()).toEqual([])

    await net.fail(`booking-groups/${group.id}`, {
      method: "PUT",
      status: 422,
      body: { message: "The given data was invalid.", errors: { "bookings.0.starts_at": ["The starts at is required."] } },
    })
    await textarea.fill(JSON.stringify({ bookings: [{ id: group.bookings[0].id }] }))
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    const alert = dialog.getByRole("alert").filter({ hasText: "Request failed (422)" })
    await expect(alert).toContainText("The given data was invalid.")
    await expect(alert).toContainText("bookings.0.starts_at: The starts at is required.")
    await expect(dialog).toBeVisible()
    // Shown once, in the dialog: no toast as well (it would be raised before the dialog shows the error).
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
  })

  test("an empty group explains itself and links to adding a booking", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await emptyTheGroup(api, group)
    await openGroup(page, group)

    await expect(ui.main().getByText("No bookings in this group")).toBeVisible()
    await expect(ui.main().getByText("Add a booking to this group, or delete the empty group.")).toBeVisible()
    await expect(ui.main().getByText("0 bookings", { exact: true })).toBeVisible()
    await expect(detailValue(page, "Span")).toHaveText("No bookings")
    await expect(detailValue(page, "Status")).toHaveText("No bookings")
    await expect(detailValue(page, "Services")).toHaveText("—")
    await expect(detailValue(page, "Locations")).toHaveText("—")

    // One link in the header, one in the empty table.
    const links = ui.main().getByRole("link", { name: "Add booking" })
    await expect(links).toHaveCount(2)
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute("href", `/bookings/new?booking_group=${group.id}`)
    }
    await links.last().click()
    await expect(page).toHaveURL(`/bookings/new?booking_group=${group.id}`)
    await expect(ui.heading("New booking")).toBeVisible()
  })

  test("deleting an empty group offers plain Delete group", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    await emptyTheGroup(api, group)
    await openGroup(page, group)
    await expect(ui.main().getByText("No bookings in this group")).toBeVisible()

    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    const title = `Delete group ${short(group.id)}?`
    await expect(ui.alertDialog(title).getByRole("button", { name: "Delete group and bookings" })).toHaveCount(0)
    const request = net.waitFor("DELETE", `booking-groups/${group.id}`)
    await ui.confirm(title, "Delete group")
    await request
    await expect(page).toHaveURL("/booking-groups")
    await expectToast(page, "Booking group deleted")
  })

  test("the delete dialog of an empty group doesn't mention 0 bookings", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await emptyTheGroup(api, group)
    await openGroup(page, group)
    await expect(ui.main().getByText("No bookings in this group")).toBeVisible()

    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    const dialog = ui.alertDialog(`Delete group ${short(group.id)}?`)
    await expect(dialog.getByRole("button", { name: "Delete group", exact: true })).toBeVisible()
    await expect(dialog).toContainText("This permanently deletes the group. It has no bookings. This can't be undone.")
    await expect(dialog).not.toContainText("0 of its bookings")
    await expect(dialog).not.toContainText("remove them from the group")
  })

  test("an unknown group shows a 404", async ({ page, ui }) => {
    await page.goto("/booking-groups/00000000-0000-4000-8000-000000000000")
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (404)" })
    await expect(alert).toBeVisible()
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible()
  })

  test("a failed load offers Retry", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    // The first attempt and the automatic retry of a 5xx both fail.
    await net.fail(`booking-groups/${group.id}`, {
      method: "GET",
      status: 500,
      times: 2,
      body: { message: "Server Error" },
    })
    await page.goto(`/booking-groups/${group.id}`)
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (500)" })
    await expect(alert).toContainText("Server Error", { timeout: 10_000 })

    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(ui.heading(`Booking group ${short(group.id)}`)).toBeVisible()
    await expect(alert).toBeHidden()
  })
})
