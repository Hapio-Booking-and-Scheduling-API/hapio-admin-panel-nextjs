import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { expectNoToast, expectToast } from "../helpers/toasts"
import { emptyTheGroup, formatStamp, seedGroup, seedIds, short } from "./_helpers"

const NOTE = "Booking filters match a group when any of its bookings match; the whole group is shown."
const NO_MATCH = "No booking groups match these filters."
const FIRST_RUN = "Group bookings that belong together, like a series or a package."

test.describe("booking groups list", () => {
  test("shows the seed group with its count, span, services and status", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await page.goto("/booking-groups")

    const row = ui.row(short(group.id))
    await expect(row.getByRole("cell").nth(4)).toHaveText("2 confirmed")
    await ui.expectRowCount(1)
    const cells = row.getByRole("cell")
    // Group: short id and the metadata keys.
    await expect(cells.nth(0)).toContainText(short(group.id))
    await expect(cells.nth(0)).toContainText("party, note")
    await expect(cells.nth(1)).toHaveText(String(SEED.group.bookings))
    // Span: both haircuts run 10:00–10:45 on Tue 3 Nov.
    await expect(cells.nth(2)).toContainText("Tue 3 Nov 2026")
    await expect(cells.nth(2)).toContainText("10:00–10:45")
    await expect(cells.nth(3)).toHaveText("Haircut")
    await expect(cells.nth(5)).toHaveText(formatStamp(group.created_at).replace(/ \(.*\)$/, ""))
    await expect(row.getByRole("button", { name: `Actions for group ${short(group.id)}` })).toBeVisible()
    await expect(ui.paginationSummary()).toHaveText("1–1 of 1")
  })

  test("shortens a long list of services", async ({ page, api, ui }) => {
    const ids = await seedIds(api)
    const equipment = await api.idOf("services", SEED.services.equipment.name)
    const at = (day: number, from: string, to: string) => ({
      starts_at: `2026-11-${day}T${from}:00+01:00`,
      ends_at: `2026-11-${day}T${to}:00+01:00`,
    })
    const group = await api.post<{ id: string }>("booking-groups", {
      bookings: [
        { service_id: ids.haircut, location_id: ids.stockholm, ...at(10, "10:00", "10:45") },
        { service_id: ids.studio, location_id: ids.stockholm, resource_id: ids.roomA, ...at(10, "11:00", "12:00") },
        { service_id: equipment, location_id: ids.stockholm, resource_id: ids.roomA, ...at(11, "09:00", "17:00") },
      ],
    })
    await page.goto("/booking-groups")
    const row = ui.row(short(group.id))
    const services = row.getByRole("cell").nth(3)
    await expect(services).toHaveText("Haircut, Studio rental +1")
    await expect(services.locator("[title]")).toHaveAttribute("title", "Haircut, Studio rental, Equipment rental")
    await expect(row.getByRole("cell").nth(1)).toHaveText("3")
    // Different days: the span shows both ends.
    await expect(row.getByRole("cell").nth(2)).toContainText("Tue 10 Nov 2026")
    await expect(row.getByRole("cell").nth(2)).toContainText("10:00 → 11 Nov, 17:00")
  })

  test("explains that booking filters match whole groups", async ({ page, ui }) => {
    await page.goto("/booking-groups")
    await expect(ui.row("2 confirmed")).toBeVisible()
    await expect(ui.main().getByText(NOTE)).toBeVisible()
  })

  test("asks Hapio for every temporary and canceled booking by default", async ({ page, net, ui }) => {
    const request = net.waitFor("GET", "booking-groups")
    await page.goto("/booking-groups")
    await expect(ui.row("2 confirmed")).toBeVisible()
    expect((await request).query).toMatchObject({ temporary: "include", canceled: "include", page: "1", per_page: "25" })
  })

  test("a resource filter keeps a group when any of its bookings match", async ({ page, api, net, ui }) => {
    const ids = await seedIds(api)
    await page.goto("/booking-groups")
    await expect(ui.row("2 confirmed")).toBeVisible()

    // Only Alva's haircut is with Anna; the whole group is still listed.
    const anna = net.waitFor("GET", "booking-groups", (c) => c.query.resource === ids.anna)
    await ui.pick(page.getByRole("combobox", { name: "Resource filter" }), "Anna")
    await anna
    await expect(page).toHaveURL(new RegExp(`resource=${ids.anna}`))
    await expect(ui.row("2 confirmed").getByRole("cell").nth(1)).toHaveText("2")

    // Nobody in the group booked Room A.
    const roomA = net.waitFor("GET", "booking-groups", (c) => c.query.resource === ids.roomA)
    await ui.pick(page.getByRole("combobox", { name: "Resource filter" }), "Room A")
    await roomA
    await expect(ui.main().getByText(NO_MATCH)).toBeVisible()
    await ui.expectRowCount(0)

    await ui.main().getByRole("button", { name: "Reset filters" }).click()
    await expect(ui.row("2 confirmed")).toBeVisible()
    await expect(page).not.toHaveURL(/resource=/)
  })

  for (const [label, filter, option] of [
    ["location", "Location filter", SEED.locations.newYork.name],
    ["service", "Service filter", SEED.services.studio.name],
  ] as const) {
    test(`a ${label} filter that no booking matches hides the group`, async ({ page, net, ui }) => {
      await page.goto("/booking-groups")
      await expect(ui.row("2 confirmed")).toBeVisible()

      const request = net.waitFor("GET", "booking-groups", (c) => !!c.query[label])
      await ui.pick(page.getByRole("combobox", { name: filter }), option)
      await request
      await expect(ui.main().getByText(NO_MATCH)).toBeVisible()
      await expect(ui.paginationSummary()).toHaveText("No results")

      // The bar's own Reset clears it too.
      await ui.main().getByRole("button", { name: "Reset", exact: true }).click()
      await expect(ui.row("2 confirmed")).toBeVisible()
    })
  }

  test("status filters narrow by the group's bookings", async ({ page, net, ui }) => {
    await page.goto("/booking-groups")
    await expect(ui.row("2 confirmed")).toBeVisible()

    const onlyCanceled = net.waitFor("GET", "booking-groups", (c) => c.query.canceled === "only")
    await ui.choose(page.getByRole("combobox", { name: "Filter canceled" }), "Only canceled")
    await onlyCanceled
    await expect(ui.main().getByText(NO_MATCH)).toBeVisible()

    const hideCanceled = net.waitFor("GET", "booking-groups", (c) => c.query.canceled === "exclude")
    await ui.choose(page.getByRole("combobox", { name: "Filter canceled" }), "Hide canceled")
    await hideCanceled
    await expect(ui.row("2 confirmed")).toBeVisible()
  })

  test("a date range that misses every booking hides the group", async ({ page, net, ui }) => {
    await page.goto("/booking-groups")
    await expect(ui.row("2 confirmed")).toBeVisible()

    // Next 7 days ends on 28 Oct; the group is on 3 Nov.
    const request = net.waitFor("GET", "booking-groups", (c) => !!c.query.from && !!c.query.to)
    await page.getByRole("button", { name: "Date range: Any date" }).click()
    await page.getByRole("button", { name: "Next 7 days" }).click()
    const call = await request
    expect(call.query.from).toBe("2026-10-21T00:00:00+02:00")
    expect(call.query.to).toBe("2026-10-28T00:00:00+01:00")
    await expect(ui.main().getByText(NO_MATCH)).toBeVisible()

    await page.getByRole("button", { name: "Date range: Next 7 days" }).click()
    await page.getByRole("button", { name: "All dates" }).click()
    await expect(ui.row("2 confirmed")).toBeVisible()
  })

  test('filters by group metadata with "= (string)"', async ({ page, net, ui }) => {
    await page.goto("/booking-groups")
    await expect(ui.row("2 confirmed")).toBeVisible()

    const applyCondition = async (value: string) => {
      await page.getByRole("button", { name: /^Filters/ }).click()
      const condition = page.getByRole("group", { name: "Condition 1" })
      await ui.choose(condition.getByRole("combobox", { name: "Field" }), "Group metadata")
      await ui.choose(condition.getByRole("combobox", { name: "Operator" }), "= (string)")
      await condition.getByRole("textbox", { name: "Property" }).fill("party")
      await condition.getByRole("textbox", { name: "Value" }).fill(value)
      await page.getByRole("button", { name: "Apply", exact: true }).click()
    }

    const match = net.waitFor("GET", "booking-groups", (c) => c.query["group_metadata[party][seq]"] === "Lindqvist")
    await applyCondition("Lindqvist")
    await match
    await expect(ui.row("2 confirmed")).toBeVisible()
    await expect(page.getByRole("button", { name: /^Filters/ })).toHaveText(/Filters\s*1/)
    const chip = page.getByRole("button", { name: "Remove filter: Group metadata party = (string) Lindqvist" })
    await expect(chip).toBeVisible()

    await chip.click()
    await expect(chip).toBeHidden()

    const miss = net.waitFor("GET", "booking-groups", (c) => c.query["group_metadata[party][seq]"] === "Holm")
    await applyCondition("Holm")
    await miss
    await expect(ui.main().getByText(NO_MATCH)).toBeVisible()
  })

  test("offers the booking sorts the spec allows for groups, and the endpoint accepts each", async ({ page, ui }) => {
    await page.goto("/booking-groups")
    await expect(ui.row("2 confirmed")).toBeVisible()

    const sort = page.getByRole("combobox", { name: "Sort" })
    await sort.click()
    const labels = await page.locator('[data-slot="select-content"]').last().getByRole("option").allTextContents()
    await page.keyboard.press("Escape")
    // GET /booking-groups uses the same sort enum as bookings (Hapio API v1.7).
    expect(labels).toEqual([
      "Default order",
      ...["Start", "End", "Buffer start", "Buffer end", "Created", "Updated"].flatMap((l) => [`${l} ↑`, `${l} ↓`]),
    ])
    for (const label of labels.filter((l) => l !== "Default order")) {
      const response = page.waitForResponse(
        (r) => r.url().includes("/api/hapio/booking-groups?") && new URL(r.url()).searchParams.has("sort")
      )
      await ui.choose(sort, label)
      expect((await response).status(), `sorting by ${label}`).toBe(200)
      await expect(ui.row("2 confirmed")).toBeVisible()
    }
  })

  test("the Span header sorts groups by their earliest booking", async ({ page, api, ui, net }) => {
    const ids = await seedIds(api)
    const seed = await seedGroup(api)
    // A second group that starts before the seed group (Tue 3 Nov).
    const earlier = await api.post<{ id: string }>("booking-groups", {
      bookings: [
        { service_id: ids.haircut, location_id: ids.stockholm, resource_id: ids.ben, starts_at: "2026-10-30T11:00:00+01:00", ends_at: "2026-10-30T11:45:00+01:00" },
      ],
    })
    await page.goto("/booking-groups")
    await ui.expectRowCount(2)

    const header = ui.main().getByRole("columnheader", { name: "Span" }).getByRole("button")
    const asc = net.waitFor("GET", "booking-groups", (c) => c.query.sort === "starts_at.asc")
    await header.click()
    await asc
    await expect(page).toHaveURL(/sort=starts_at\.asc/)
    const rows = ui.main().getByRole("table").locator("tbody tr")
    await expect(rows.first()).toContainText(short(earlier.id))

    const desc = net.waitFor("GET", "booking-groups", (c) => c.query.sort === "starts_at.desc")
    await header.click()
    await desc
    await expect(rows.first()).toContainText(short(seed.id))
  })

  test("lists a group whose bookings were all removed", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await emptyTheGroup(api, group)
    await page.goto("/booking-groups")

    const row = ui.row(short(group.id))
    await expect(row.getByRole("cell").nth(4)).toHaveText("No bookings")
    await expect(row.getByRole("cell").nth(1)).toHaveText("0")
    await expect(row.getByRole("cell").nth(2)).toHaveText("—")
    await expect(row.getByRole("cell").nth(3)).toHaveText("—")
  })

  test("View opens the group", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await page.goto("/booking-groups")
    const row = ui.row(short(group.id))
    await expect(row).toContainText("2 confirmed")

    await ui.rowAction(row, "View")
    await expect(page).toHaveURL(`/booking-groups/${group.id}`)
    await expect(ui.heading(`Booking group ${short(group.id)}`)).toBeVisible()
  })

  test("clicking a row opens the group", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await page.goto("/booking-groups")
    await ui.row(short(group.id)).getByRole("cell").nth(4).click()
    await expect(page).toHaveURL(`/booking-groups/${group.id}`)
    await expect(ui.heading(`Booking group ${short(group.id)}`)).toBeVisible()
  })

  test("Delete removes the group and its bookings after confirming", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    await page.goto("/booking-groups")
    const row = ui.row(short(group.id))
    await expect(row).toContainText("2 confirmed")

    await ui.rowAction(row, "Delete")
    const dialog = ui.alertDialog(`Delete group ${short(group.id)}?`)
    await expect(dialog).toContainText(
      "This permanently deletes the group and all 2 of its bookings. This can't be undone."
    )
    const request = net.waitFor("DELETE", `booking-groups/${group.id}`)
    await ui.confirm(`Delete group ${short(group.id)}?`, "Delete group and bookings")
    await request
    await expectToast(page, "Booking group deleted", { type: "success" })

    await expect(ui.main().getByText("No booking groups", { exact: true })).toBeVisible()
    await expect(ui.main().getByText(FIRST_RUN)).toBeVisible()
    expect(await api.list("booking-groups")).toEqual([])
    const remaining = await api.list("bookings")
    expect(remaining).toHaveLength(SEED.bookings.length - SEED.group.bookings)
    expect(remaining.map((b) => b.id)).not.toContain(group.bookings[0].id)
  })

  test("cancelling Delete keeps the group", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    await page.goto("/booking-groups")
    const row = ui.row(short(group.id))
    await expect(row).toContainText("2 confirmed")

    await ui.rowAction(row, "Delete")
    await ui.dismiss(`Delete group ${short(group.id)}?`)
    await expect(row).toBeVisible()
    expect(net.mutations()).toEqual([])
    expect(await api.list("booking-groups")).toHaveLength(1)
  })

  test("a failed Delete shows the error and keeps the dialog open", async ({ page, api, net, ui }) => {
    const group = await seedGroup(api)
    await net.fail(`booking-groups/${group.id}`, {
      method: "DELETE",
      status: 500,
      body: { message: "Server Error" },
    })
    await page.goto("/booking-groups")
    const row = ui.row(short(group.id))
    await expect(row).toContainText("2 confirmed")

    await ui.rowAction(row, "Delete")
    const dialog = ui.alertDialog(`Delete group ${short(group.id)}?`)
    await dialog.getByRole("button", { name: "Delete group and bookings" }).click()
    // The modal dialog covers the toast's close button, so leave the toast open.
    await expectToast(page, "Server Error", { type: "error", close: false })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Delete group and bookings" })).toBeEnabled()
    await expectNoToast(page, "Booking group deleted")
    expect(await api.list("booking-groups")).toHaveLength(1)
  })

  test("deleting an empty group offers plain Delete group", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await emptyTheGroup(api, group)
    await page.goto("/booking-groups")
    const row = ui.row(short(group.id))
    await expect(row).toContainText("No bookings")

    await ui.rowAction(row, "Delete")
    const dialog = ui.alertDialog(`Delete group ${short(group.id)}?`)
    await expect(dialog.getByRole("button", { name: "Delete group", exact: true })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Delete group and bookings" })).toHaveCount(0)
    await ui.confirm(`Delete group ${short(group.id)}?`, "Delete group")
    await expectToast(page, "Booking group deleted")
    expect(await api.list("booking-groups")).toEqual([])
  })

  test("the delete dialog of an empty group doesn't mention 0 bookings", async ({ page, api, ui }) => {
    const group = await seedGroup(api)
    await emptyTheGroup(api, group)
    await page.goto("/booking-groups")
    const row = ui.row(short(group.id))
    await expect(row).toContainText("No bookings")

    await ui.rowAction(row, "Delete")
    const dialog = ui.alertDialog(`Delete group ${short(group.id)}?`)
    await expect(dialog.getByRole("button", { name: "Delete group", exact: true })).toBeVisible()
    await expect(dialog).toContainText("This permanently deletes the group. It has no bookings. This can't be undone.")
    await expect(dialog).not.toContainText("0 of its bookings")
  })

  test("deleting the only group on the last page goes back a page", async ({ page, api, ui }) => {
    const ids = await seedIds(api)
    for (let day = 10; day < 20; day++) {
      await api.post("booking-groups", {
        bookings: [
          {
            service_id: ids.haircut,
            location_id: ids.stockholm,
            starts_at: `2026-11-${day}T10:00:00+01:00`,
            ends_at: `2026-11-${day}T10:45:00+01:00`,
          },
        ],
      })
    }
    await page.goto("/booking-groups?per_page=10&page=2")
    await expect(ui.paginationSummary()).toHaveText("11–11 of 11")
    await ui.expectRowCount(1)

    await ui.rowAction(ui.main().getByRole("row").nth(1), "Delete")
    await ui.confirm(/^Delete group/, "Delete group and bookings")
    await expectToast(page, "Booking group deleted")

    await expect(ui.paginationSummary()).toHaveText("1–10 of 10", { timeout: 3_000 })
    await expect(ui.main().getByText(FIRST_RUN)).toBeHidden()
  })
})

test.describe("booking groups list without data", () => {
  test.use({ seed: "empty" })

  test("shows the first-run empty state with a link to create a group", async ({ page, ui }) => {
    await page.goto("/booking-groups")
    await expect(ui.main().getByText("No booking groups", { exact: true })).toBeVisible()
    await expect(ui.main().getByText(FIRST_RUN)).toBeVisible()
    await expect(ui.paginationSummary()).toHaveText("No results")
    await expect(ui.main().getByRole("button", { name: "Reset filters" })).toHaveCount(0)

    const links = ui.main().getByRole("link", { name: "New booking group" })
    await expect(links).toHaveCount(2)
    await links.last().click()
    await expect(page).toHaveURL("/booking-groups/new")
    await expect(ui.heading("New booking group")).toBeVisible()
  })

  test("with filters active, the empty state offers to reset them", async ({ page, ui }) => {
    await page.goto("/booking-groups?canceled=only")
    await expect(ui.main().getByText(NO_MATCH)).toBeVisible()
    await ui.main().getByRole("button", { name: "Reset filters" }).click()
    await expect(ui.main().getByText(FIRST_RUN)).toBeVisible()
    await expect(page).not.toHaveURL(/canceled=/)
  })
})
