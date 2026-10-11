import type { Locator, Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import type { HapioApi } from "../fixtures/hapio-api"
import { expectNoToast, expectToast } from "../helpers/toasts"
import {
  fieldError,
  fixDateSubclassing,
  formField,
  gotoResource,
  recurringBlocksOf,
  recurringSchedulesOf,
  refetchOnReconnect,
  scheduleAt,
} from "./_helpers"

const { anna, ben } = SEED.resources
const { stockholm, newYork } = SEED.locations
const OVERLAP = "The schedule block overlaps with another block on the same weekday."
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

// Zone conversions (TZDate) need Date subclassing, which the fake clock breaks.
test.beforeEach(async ({ page }) => fixDateSubclassing(page))

function urlParam(page: Page, key: string) {
  return new URL(page.url()).searchParams.get(key)
}

/** A recurring schedule's collapsible card, by location name. */
function card(page: Page, location: string) {
  return page.getByRole("main").locator('[data-slot="collapsible"]').filter({ hasText: location })
}

function trigger(scheduleCard: Locator) {
  return scheduleCard.locator('[data-slot="collapsible-trigger"]')
}

/** The weekday's row in the block list under the weekly timeline. */
function dayRow(scheduleCard: Locator, weekday: string) {
  return scheduleCard.getByRole("listitem").filter({ hasText: weekday })
}

function chip(scope: Locator, label: string) {
  return scope.getByRole("button", { name: label, exact: true })
}

/** Ben has one recurring schedule (Stockholm, Mon–Fri 09–17), so it opens expanded. */
async function openBen(page: Page, api: HapioApi) {
  const resource = await gotoResource(page, api, ben.name, { tab: "recurring" })
  const benCard = card(page, stockholm.name)
  await expect(benCard.getByText("5 blocks · 40 h per week")).toBeVisible()
  const schedule = await scheduleAt(api, resource.id, stockholm.name)
  return { resource, schedule, benCard }
}

test.describe("recurring schedules list", () => {
  test("Anna's two schedules start collapsed with status, range and interval", async ({ page, api, ui }) => {
    await gotoResource(page, api, anna.name, { tab: "recurring" })
    for (const location of [stockholm, newYork]) {
      const scheduleCard = card(page, location.name)
      await expect(trigger(scheduleCard)).toHaveText(
        `${location.name}Active21 Sep 2026 → Indefinitely · Every week · ${location.timeZone}`
      )
      await expect(trigger(scheduleCard)).toHaveAttribute("aria-expanded", "false")
      await expect(
        scheduleCard.getByRole("button", { name: `Actions for schedule at ${location.name}, 21 Sep 2026 → Indefinitely` })
      ).toBeVisible()
    }
    await expect(ui.main().getByText(/blocks · .* per week/)).toHaveCount(0)

    await trigger(card(page, newYork.name)).click()
    await expect(card(page, newYork.name).getByText("5 blocks · 40 h per week")).toBeVisible()
    await expect(trigger(card(page, stockholm.name))).toHaveAttribute("aria-expanded", "false")
  })

  test("a lone schedule opens with its weekly hours", async ({ page, api }) => {
    const { benCard } = await openBen(page, api)
    await expect(trigger(benCard)).toHaveAttribute("aria-expanded", "true")
    for (const day of WEEKDAYS.slice(0, 5)) {
      await expect(chip(dayRow(benCard, day), `${day} 09:00–17:00`)).toHaveText("09:00–17:00")
    }
    for (const day of ["Saturday", "Sunday"]) await expect(dayRow(benCard, day)).toContainText("No hours")

    const timeline = benCard.getByRole("figure", { name: "Weekly hours" })
    await expect(timeline.getByRole("button")).toHaveCount(5)
    await expect(timeline.getByRole("button").first()).toHaveAccessibleName("Monday 09:00–17:00 · click to edit")
  })

  test("clicking a span on the weekly timeline edits that block", async ({ page, api, ui }) => {
    const { benCard } = await openBen(page, api)
    await benCard.getByRole("figure", { name: "Weekly hours" }).getByRole("button", { name: "Wednesday 09:00–17:00 · click to edit" }).click()
    const dialog = ui.dialog("Edit block")
    await expect(dialog.getByRole("combobox", { name: "Weekday" })).toHaveText("Wednesday")
    await expect(dialog.getByLabel("Start time")).toHaveValue("09:00")
    await expect(dialog.getByLabel("End time")).toHaveValue("17:00")
  })

  test("shows upcoming and ended schedules", async ({ page, api }) => {
    const benId = await api.idOf("resources", ben.name)
    const location_id = await api.idOf("locations", newYork.name)
    await api.post(`resources/${benId}/recurring-schedules`, { location_id, start_date: "2026-01-05", end_date: "2026-06-30" })
    await api.post(`resources/${benId}/recurring-schedules`, { location_id, start_date: "2026-10-22", interval: 3 })
    await gotoResource(page, api, ben.name, { tab: "recurring" })
    const cards = page.getByRole("main").locator('[data-slot="collapsible-trigger"]')
    await expect(cards).toHaveText([
      `${stockholm.name}Active21 Sep 2026 → Indefinitely · Every week · ${stockholm.timeZone}`,
      `${newYork.name}Ended5 Jan 2026 → 30 Jun 2026 · Every week · ${newYork.timeZone}`,
      `${newYork.name}Upcoming22 Oct 2026 → Indefinitely · Every 3 weeks · ${newYork.timeZone}`,
    ])
  })

  test("filters and sorts under rs_* URL keys", async ({ page, api, ui }) => {
    const nyId = await api.idOf("locations", newYork.name)
    await gotoResource(page, api, anna.name, { tab: "recurring" })
    await expect(trigger(card(page, stockholm.name))).toBeVisible()

    await ui.pick(ui.main().getByRole("combobox", { name: "Location filter" }), newYork.name)
    await expect.poll(() => urlParam(page, "rs_location")).toBe(nyId)
    await expect(card(page, stockholm.name)).toHaveCount(0)
    // Now alone, the New York schedule opens.
    await expect(card(page, newYork.name).getByText("5 blocks · 40 h per week")).toBeVisible()
    expect(urlParam(page, "sb_location")).toBeNull()
    await ui.main().getByRole("button", { name: "Clear location filter" }).click()
    await expect(card(page, stockholm.name)).toBeVisible()

    // Exact: "To" alone would also match "Actions for schedule at Stockholm Studio…".
    await ui.main().getByLabel("To", { exact: true }).fill("2026-09-20")
    await expect.poll(() => urlParam(page, "rs_to")).toBe("2026-09-20")
    await expect(ui.main().getByText("No recurring schedules match these filters.")).toBeVisible()
    await ui.main().getByLabel("To", { exact: true }).fill("2026-09-21")
    await expect(card(page, stockholm.name)).toBeVisible()
    await ui.main().getByLabel("From", { exact: true }).fill("2026-12-01")
    await expect.poll(() => urlParam(page, "rs_from")).toBe("2026-12-01")
    await expect(page.getByRole("main").locator('[data-slot="collapsible"]')).toHaveCount(2)

    await ui.choose(ui.main().getByRole("combobox", { name: "Sort" }), "Created ↓")
    await expect.poll(() => urlParam(page, "rs_sort")).toBe("created_at.desc")
    await expect(page.getByRole("main").locator('[data-slot="collapsible-trigger"]').first()).toContainText(newYork.name)

    // Reset clears the filters; the sort isn't a filter and stays.
    await ui.main().getByRole("button", { name: "Reset" }).click()
    await expect.poll(() => urlParam(page, "rs_from")).toBeNull()
    expect(urlParam(page, "rs_to")).toBeNull()
    expect(urlParam(page, "rs_sort")).toBe("created_at.desc")
    await expect(ui.main().getByLabel("From", { exact: true })).toHaveValue("")
    await expect(page.getByRole("main").locator('[data-slot="collapsible-trigger"]')).toHaveCount(2)
    await expect(page.getByRole("main").locator('[data-slot="collapsible-trigger"]').first()).toContainText(newYork.name)
  })

  test("deletes a schedule after confirming", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, anna.name, { tab: "recurring" })
    const ny = await scheduleAt(api, resource.id, newYork.name)
    await ui.rowAction(card(page, newYork.name), "Delete")
    const confirm = ui.alertDialog("Delete recurring schedule?")
    await expect(confirm).toContainText(
      `The schedule at ${newYork.name} (21 Sep 2026 → Indefinitely) and all of its weekday blocks are permanently deleted.`
    )
    const del = net.waitFor("DELETE", `resources/${resource.id}/recurring-schedules/${ny.id}`)
    await ui.confirm("Delete recurring schedule?", "Delete schedule")
    await del
    await expectToast(page, "Recurring schedule deleted")
    await expect(card(page, newYork.name)).toHaveCount(0)
    await expect(card(page, stockholm.name).getByText("5 blocks · 40 h per week")).toBeVisible()
    expect((await recurringSchedulesOf(api, resource.id)).map((s) => s.location.name)).toEqual([stockholm.name])
  })

  test("deleting the only schedule on the last page goes back a page", async ({ page, api, ui }) => {
    const benId = await api.idOf("resources", ben.name)
    const location_id = await api.idOf("locations", newYork.name)
    await api.post(`resources/${benId}/recurring-schedules`, { location_id, start_date: "2026-11-02" })
    await gotoResource(page, api, ben.name, { tab: "recurring", rs_per_page: "1", rs_page: "2" })
    await expect(ui.paginationSummary()).toHaveText("2–2 of 2")
    await expect(card(page, stockholm.name)).toHaveCount(0)
    await ui.rowAction(card(page, newYork.name), "Delete")
    await ui.confirm("Delete recurring schedule?", "Delete schedule")
    await expectToast(page, "Recurring schedule deleted")
    await expect(ui.paginationSummary()).toHaveText("1–1 of 1")
    await expect.poll(() => urlParam(page, "rs_page")).toBeNull()
    await expect(trigger(card(page, stockholm.name))).toBeVisible()
    await expect(ui.main().getByText("No recurring schedules", { exact: true })).toHaveCount(0)
  })

  test("a resource without schedules shows the empty state", async ({ page, api, ui }) => {
    await api.post("resources", { name: "Studio C" })
    await gotoResource(page, api, "Studio C", { tab: "recurring" })
    const empty = ui.main().locator('[data-slot="empty"]')
    await expect(empty).toContainText("No recurring schedules")
    await expect(empty).toContainText("Create a recurring schedule to set this resource's weekly hours at a location.")
    await empty.getByRole("button", { name: "New schedule" }).click()
    await expect(ui.dialog("New recurring schedule")).toBeVisible()
  })
})

test.describe("new and edited recurring schedules", () => {
  test("creates a bounded schedule every 2 weeks", async ({ page, api, ui, net }) => {
    const { resource } = await openBen(page, api)
    const nyId = await api.idOf("locations", newYork.name)
    await ui.main().getByRole("button", { name: "New schedule" }).click()

    const dialog = ui.dialog("New recurring schedule")
    await expect(dialog.getByRole("combobox", { name: "Location" })).toHaveText("Select location…")
    await expect(dialog.getByLabel("Start date")).toHaveValue("2026-10-21")
    const end = dialog.getByLabel("End date")
    await expect(end).toBeDisabled()
    await expect(dialog.getByRole("switch", { name: "Runs indefinitely" })).toBeChecked()
    const repeat = dialog.getByRole("spinbutton", { name: "Repeat" })
    await expect(repeat).toHaveValue("1")
    await expect(formField(dialog, "Repeat")).toContainText("Everyweek")
    await expect(formField(dialog, "Repeat")).toContainText("The weekly blocks apply every week.")

    await ui.pick(dialog.getByRole("combobox", { name: "Location" }), newYork.name)
    await expect(formField(dialog, "Location")).toContainText("Dates and times are in America/New_York.")
    await dialog.getByLabel("Start date").fill("2026-11-02")
    await dialog.getByRole("switch", { name: "Runs indefinitely" }).click()
    await expect(end).toBeEnabled()
    await expect(end).toHaveValue("2026-11-02")
    await end.fill("2026-11-30")
    await repeat.fill("2")
    await expect(formField(dialog, "Repeat")).toContainText("Everyweeks")
    await expect(formField(dialog, "Repeat")).toContainText(
      "The weekly blocks apply once every 2 weeks, counting from the week of the start date."
    )

    const post = net.waitFor("POST", `resources/${resource.id}/recurring-schedules`)
    await dialog.getByRole("button", { name: "Create schedule" }).click()
    expect((await post).body).toEqual({ location_id: nyId, start_date: "2026-11-02", end_date: "2026-11-30", interval: 2 })
    await expectToast(page, "Recurring schedule created", { type: "success" })
    await expect(dialog).toBeHidden()

    const created = card(page, newYork.name)
    await expect(trigger(created)).toHaveText(`${newYork.name}Upcoming2 Nov 2026 → 30 Nov 2026 · Every 2 weeks · ${newYork.timeZone}`)
    await expect(trigger(created)).toHaveAttribute("aria-expanded", "true")
    await expect(created.getByText("No weekly hours yet")).toBeVisible()
    await expect(created.getByRole("button", { name: "Add weekday hours" })).toBeVisible()
  })

  test("rejects an end date before the start date and invalid intervals", async ({ page, api, ui, net }) => {
    await openBen(page, api)
    await ui.main().getByRole("button", { name: "New schedule" }).click()
    const dialog = ui.dialog("New recurring schedule")
    await dialog.getByRole("button", { name: "Create schedule" }).click()
    await expect(fieldError(dialog, "Location")).toHaveText("Required")

    await ui.pick(dialog.getByRole("combobox", { name: "Location" }), stockholm.name)
    await dialog.getByRole("switch", { name: "Runs indefinitely" }).click()
    await dialog.getByLabel("End date").fill("2026-10-01")
    await dialog.getByRole("spinbutton", { name: "Repeat" }).fill("0")
    await dialog.getByRole("button", { name: "Create schedule" }).click()
    await expect(fieldError(dialog, "End date")).toHaveText("Can't be before the start date")
    await expect(fieldError(dialog, "Repeat")).toHaveText("Must be at least 1")
    expect(net.find("POST", /recurring-schedules$/)).toHaveLength(0)

    // Back to indefinite clears the end date error.
    await dialog.getByRole("switch", { name: "Runs indefinitely" }).click()
    await expect(fieldError(dialog, "End date")).toHaveCount(0)
  })

  test("edits only the changed fields", async ({ page, api, ui, net }) => {
    const { resource, schedule, benCard } = await openBen(page, api)
    await ui.rowAction(benCard, "Edit")
    const dialog = ui.dialog("Edit recurring schedule")
    await expect(dialog.getByRole("combobox", { name: "Location" })).toHaveText(stockholm.name)
    await expect(dialog.getByLabel("Start date")).toHaveValue("2026-09-21")
    await expect(dialog.getByRole("switch", { name: "Runs indefinitely" })).toBeChecked()
    await dialog.getByRole("spinbutton", { name: "Repeat" }).fill("2")
    const patch = net.waitFor("PATCH", `resources/${resource.id}/recurring-schedules/${schedule.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toEqual({ interval: 2 })
    await expectToast(page, "Recurring schedule updated")
    await expect(trigger(benCard)).toContainText("21 Sep 2026 → Indefinitely · Every 2 weeks")
  })

  test("saving an unchanged schedule sends nothing", async ({ page, api, ui, net }) => {
    const { benCard } = await openBen(page, api)
    await ui.rowAction(benCard, "Edit")
    const dialog = ui.dialog("Edit recurring schedule")
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await expectToast(page, "No changes to save", { type: "info" })
    await expect(dialog).toBeHidden()
    expect(net.find("PATCH", /recurring-schedules\/[^/]+$/)).toHaveLength(0)
  })

  test("keeps typed schedule edits when the list refetches", async ({ page, api, ui, net }) => {
    const { resource, schedule, benCard } = await openBen(page, api)
    await ui.rowAction(benCard, "Edit")
    const dialog = ui.dialog("Edit recurring schedule")
    await dialog.getByRole("spinbutton", { name: "Repeat" }).fill("3")

    await api.patch(`resources/${resource.id}/recurring-schedules/${schedule.id}`, { end_date: "2026-12-31" })
    await refetchOnReconnect(page)
    await expect(page.locator("main").getByText("21 Sep 2026 → 31 Dec 2026", { exact: false })).toBeVisible()

    await expect(dialog.getByRole("spinbutton", { name: "Repeat" })).toHaveValue("3")
    const patch = net.waitFor("PATCH", `resources/${resource.id}/recurring-schedules/${schedule.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toMatchObject({ interval: 3 })
  })
})

test.describe("weekday blocks", () => {
  test("adds a block on a preset weekday", async ({ page, api, ui, net }) => {
    const { resource, schedule, benCard } = await openBen(page, api)
    await dayRow(benCard, "Saturday").getByRole("button", { name: "Add block on Saturday" }).click()
    const dialog = ui.dialog("Add block")
    await expect(dialog.getByRole("combobox", { name: "Weekday" })).toHaveText("Saturday")
    await expect(dialog.getByLabel("Start time")).toHaveValue("09:00")
    await expect(dialog.getByLabel("End time")).toHaveValue("17:00")
    await expect(dialog).toContainText("Blocks in the same recurring schedule can't overlap.")

    await dialog.getByLabel("Start time").fill("10:00")
    const post = net.waitFor("POST", `resources/${resource.id}/recurring-schedules/${schedule.id}/schedule-blocks`)
    await dialog.getByRole("button", { name: "Add block" }).click()
    expect((await post).body).toEqual({ weekday: "saturday", start_time: "10:00:00", end_time: "17:00:00" })
    await expectToast(page, "Block added")
    await expect(chip(dayRow(benCard, "Saturday"), "Saturday 10:00–17:00")).toBeVisible()
    await expect(benCard.getByText("6 blocks · 47 h per week")).toBeVisible()
  })

  test("validates times before sending", async ({ page, api, ui, net }) => {
    const { benCard } = await openBen(page, api)
    await benCard.getByRole("button", { name: "Add block", exact: true }).click()
    const dialog = ui.dialog("Add block")
    await expect(dialog.getByRole("combobox", { name: "Weekday" })).toHaveText("Monday")
    await dialog.getByLabel("End time").fill("08:00")
    await dialog.getByRole("button", { name: "Add block" }).click()
    await expect(fieldError(dialog, "End time")).toHaveText("Must be after the start time")
    await dialog.getByLabel("Start time").fill("")
    await expect(fieldError(dialog, "Start time")).toHaveText("Enter a time")
    expect(net.find("POST", /schedule-blocks$/)).toHaveLength(0)
  })

  test("an overlapping block shows the API error under Start time", async ({ page, api, ui }) => {
    const { benCard } = await openBen(page, api)
    await benCard.getByRole("button", { name: "Add block", exact: true }).click()
    const dialog = ui.dialog("Add block")
    await dialog.getByLabel("Start time").fill("12:00")
    await dialog.getByLabel("End time").fill("18:00")
    await dialog.getByRole("button", { name: "Add block" }).click()
    await expect(fieldError(dialog, "Start time")).toHaveText(OVERLAP)
    await expect(dialog).toBeVisible()
    await expectNoToast(page, OVERLAP)
  })

  test("an End of day block ends at 24:00", async ({ page, api, ui, net }) => {
    const { benCard } = await openBen(page, api)
    await dayRow(benCard, "Sunday").getByRole("button", { name: "Add block on Sunday" }).click()
    const dialog = ui.dialog("Add block")
    await dialog.getByLabel("Start time").fill("22:00")
    await dialog.getByRole("checkbox", { name: "End of day (24:00)" }).click()
    await expect(dialog.getByLabel("End time")).toBeDisabled()
    await expect(dialog.getByLabel("End time")).toHaveValue("")
    const post = net.waitFor("POST", /schedule-blocks$/)
    await dialog.getByRole("button", { name: "Add block" }).click()
    expect((await post).body).toEqual({ weekday: "sunday", start_time: "22:00:00", end_time: "24:00:00" })
    await expect(chip(dayRow(benCard, "Sunday"), "Sunday 22:00–24:00")).toBeVisible()
    await expect(benCard.getByText("6 blocks · 42 h per week")).toBeVisible()
    await expect(
      benCard.getByRole("figure", { name: "Weekly hours" }).getByRole("button", { name: "Sunday 22:00–24:00 · click to edit" })
    ).toBeVisible()
  })

  test("edits a block from its chip", async ({ page, api, ui, net }) => {
    const { resource, schedule, benCard } = await openBen(page, api)
    const monday = (await recurringBlocksOf(api, resource.id, schedule.id)).find((b) => b.weekday === "monday")!
    await chip(benCard, "Monday 09:00–17:00").click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit block")
    await dialog.getByLabel("End time").fill("16:00")
    const patch = net.waitFor("PATCH", `resources/${resource.id}/recurring-schedules/${schedule.id}/schedule-blocks/${monday.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toEqual({ end_time: "16:00:00" })
    await expectToast(page, "Block updated")
    await expect(chip(benCard, "Monday 09:00–16:00")).toBeVisible()
    await expect(benCard.getByText("5 blocks · 39 h per week")).toBeVisible()
  })

  test("deletes a block from its chip", async ({ page, api, ui, net }) => {
    const { resource, schedule, benCard } = await openBen(page, api)
    const monday = (await recurringBlocksOf(api, resource.id, schedule.id)).find((b) => b.weekday === "monday")!
    await chip(benCard, "Monday 09:00–17:00").click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    const confirm = ui.alertDialog("Delete Monday 09:00–17:00?")
    await expect(confirm).toContainText("The hours are removed from this recurring schedule.")
    const del = net.waitFor("DELETE", `resources/${resource.id}/recurring-schedules/${schedule.id}/schedule-blocks/${monday.id}`)
    await ui.confirm("Delete Monday 09:00–17:00?", "Delete block")
    await del
    await expectToast(page, "Block deleted")
    await expect(dayRow(benCard, "Monday")).toContainText("No hours")
    await expect(benCard.getByText("4 blocks · 32 h per week")).toBeVisible()
  })

  test("saving an unchanged block sends nothing", async ({ page, api, ui, net }) => {
    const { benCard } = await openBen(page, api)
    await chip(benCard, "Monday 09:00–17:00").click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit block")
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await expectToast(page, "No changes to save", { type: "info" })
    await expect(dialog).toBeHidden()
    expect(net.find("PATCH", /schedule-blocks\//)).toHaveLength(0)
  })

  test("keeps typed block edits when the blocks refetch", async ({ page, api, ui, net }) => {
    const { resource, schedule, benCard } = await openBen(page, api)
    const monday = (await recurringBlocksOf(api, resource.id, schedule.id)).find((b) => b.weekday === "monday")!
    await chip(benCard, "Monday 09:00–17:00").click()
    await page.getByRole("menuitem", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit block")
    await dialog.getByLabel("End time").fill("16:00")

    await api.patch(`resources/${resource.id}/recurring-schedules/${schedule.id}/schedule-blocks/${monday.id}`, {
      start_time: "08:00:00",
    })
    await refetchOnReconnect(page)
    await expect(page.locator("main").getByText("08:00–17:00")).toBeVisible()

    await expect(dialog.getByLabel("End time")).toHaveValue("16:00")
    const patch = net.waitFor("PATCH", `resources/${resource.id}/recurring-schedules/${schedule.id}/schedule-blocks/${monday.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toMatchObject({ end_time: "16:00:00" })
  })
})

test.describe("add weekday hours", () => {
  /** Radix renders a multiple-choice toggle group as a toolbar (roving focus with the arrow keys). */
  function days(dialog: Locator) {
    return dialog.getByRole("toolbar", { name: "Days" })
  }

  async function expectPressed(dialog: Locator, pressed: string[]) {
    for (const day of WEEKDAYS) {
      await expect(days(dialog).getByRole("button", { name: day, exact: true })).toHaveAttribute(
        "aria-pressed",
        String(pressed.includes(day))
      )
    }
  }

  test("adds the same hours on the weekend", async ({ page, api, ui, net }) => {
    const { benCard } = await openBen(page, api)
    await benCard.getByRole("button", { name: "Add weekday hours" }).click()
    const dialog = ui.dialog("Add weekday hours")
    await expectPressed(dialog, WEEKDAYS.slice(0, 5))
    await expect(dialog.getByLabel("Start time")).toHaveValue("09:00")
    await expect(dialog.getByLabel("End time")).toHaveValue("17:00")

    await dialog.getByRole("button", { name: "Weekend" }).click()
    await expectPressed(dialog, ["Saturday", "Sunday"])
    await dialog.getByLabel("Start time").fill("10:00")
    await dialog.getByLabel("End time").fill("14:00")
    await dialog.getByRole("button", { name: "Add hours" }).click()
    await expectToast(page, "Added 2 blocks", { type: "success" })
    await expect(dialog).toBeHidden()
    const posts = net.find("POST", /schedule-blocks$/).map((c) => c.body)
    expect(posts).toEqual([
      { weekday: "saturday", start_time: "10:00:00", end_time: "14:00:00" },
      { weekday: "sunday", start_time: "10:00:00", end_time: "14:00:00" },
    ])
    await expect(chip(benCard, "Saturday 10:00–14:00")).toBeVisible()
    await expect(chip(benCard, "Sunday 10:00–14:00")).toBeVisible()
    await expect(benCard.getByText("7 blocks · 48 h per week")).toBeVisible()
  })

  test("requires at least one day", async ({ page, api, ui, net }) => {
    const { benCard } = await openBen(page, api)
    await benCard.getByRole("button", { name: "Add weekday hours" }).click()
    const dialog = ui.dialog("Add weekday hours")
    for (const day of WEEKDAYS.slice(0, 5)) await days(dialog).getByRole("button", { name: day, exact: true }).click()
    await dialog.getByRole("button", { name: "Add hours" }).click()
    await expect(fieldError(dialog, "Days")).toHaveText("Pick at least one day")
    expect(net.find("POST", /schedule-blocks$/)).toHaveLength(0)
  })

  test("reports the days that overlap and keeps them selected", async ({ page, api, ui }) => {
    const { benCard } = await openBen(page, api)
    await benCard.getByRole("button", { name: "Add weekday hours" }).click()
    const dialog = ui.dialog("Add weekday hours")
    await dialog.getByRole("button", { name: "Every day" }).click()
    await expectPressed(dialog, WEEKDAYS)
    await dialog.getByLabel("Start time").fill("16:00")
    await dialog.getByLabel("End time").fill("18:00")
    await dialog.getByRole("button", { name: "Add hours" }).click()

    // The modal blocks pointer events outside it, so the toast can't be closed while it's open.
    await expectToast(page, "Added 2 of 7 blocks", { type: "success", close: false })
    await expect(dialog).toBeVisible()
    await expectPressed(dialog, WEEKDAYS.slice(0, 5))
    const alert = dialog.getByRole("alert").filter({ hasText: "Hapio rejected the request" })
    await expect(alert.getByRole("listitem")).toHaveText(WEEKDAYS.slice(0, 5).map((day) => `${day}: ${OVERLAP}`))
    // The open modal hides the page from the accessibility tree; close it to check the list.
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await expect(chip(benCard, "Saturday 16:00–18:00")).toBeVisible()
    await expect(chip(benCard, "Sunday 16:00–18:00")).toBeVisible()
  })

  test("when every day fails, nothing is toasted and every day is listed", async ({ page, api, ui }) => {
    const benId = await api.idOf("resources", ben.name)
    const schedule = await scheduleAt(api, benId, stockholm.name)
    for (const weekday of ["saturday", "sunday"]) {
      await api.post(`resources/${benId}/recurring-schedules/${schedule.id}/schedule-blocks`, {
        weekday,
        start_time: "09:00:00",
        end_time: "17:00:00",
      })
    }
    await gotoResource(page, api, ben.name, { tab: "recurring" })
    const benCard = card(page, stockholm.name)
    await expect(benCard.getByText("7 blocks · 56 h per week")).toBeVisible()
    await benCard.getByRole("button", { name: "Add weekday hours" }).click()
    const dialog = ui.dialog("Add weekday hours")
    await dialog.getByRole("button", { name: "Every day" }).click()
    await dialog.getByLabel("Start time").fill("10:00")
    await dialog.getByLabel("End time").fill("12:00")
    await dialog.getByRole("button", { name: "Add hours" }).click()

    const alert = dialog.getByRole("alert").filter({ hasText: "Hapio rejected the request" })
    await expect(alert.getByRole("listitem")).toHaveText(WEEKDAYS.map((day) => `${day}: ${OVERLAP}`))
    await expect(dialog).toBeVisible()
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
    // The open modal hides the page from the accessibility tree; close it to check the list.
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await expect(benCard.getByText("7 blocks · 56 h per week")).toBeVisible()
  })
})
