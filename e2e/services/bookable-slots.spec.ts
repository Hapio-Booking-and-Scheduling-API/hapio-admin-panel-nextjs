import type { Locator, Page } from "@playwright/test"

import { NOW_MIDDAY } from "../fixtures/constants"
import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import {
  findSlots,
  fixDateSubclassing,
  gotoSlots,
  pickSlotsLocation,
  searchSlots,
  slotBadges,
  slotDay,
  slotRow,
  slotsForm,
  slotsSummary,
} from "./_helpers"

const { haircut, studio, equipment } = SEED.services
const { anna, ben, roomA } = SEED.resources
const STOCKHOLM = SEED.locations.stockholm.name
const NEW_YORK = SEED.locations.newYork.name

const slotRequest = (page: Page) =>
  page.waitForRequest((r) => r.method() === "GET" && new URL(r.url()).pathname.endsWith("/bookable-slots"))
const quickRange = (page: Page, name: string) =>
  page.getByRole("radiogroup", { name: "Quick date ranges" }).getByRole("radio", { name })
const options = (page: Page) => page.locator('[data-slot="select-content"]').last().getByRole("option")

// Slots are shown in the location's zone (TZDate), which needs Date subclassing.
test.beforeEach(async ({ page }) => fixDateSubclassing(page))

async function pickSlotsResource(page: Page, name: string) {
  await slotsForm(page).getByRole("combobox", { name: "Resource" }).click()
  const popover = page.locator('[data-slot="popover-content"]').last()
  await popover.getByRole("option", { name }).click()
  await expect(popover).toBeHidden()
}

/** Query parameters of a booking link. */
async function hrefParams(link: Locator) {
  const href = (await link.getAttribute("href"))!
  return { href, params: new URL(href, "http://x").searchParams }
}

test.describe("bookable slots: form", () => {
  test("starts with a prompt and the next 7 days", async ({ page, api }) => {
    await gotoSlots(page, api, haircut.name)
    await expect(page.getByText("Search for slots")).toBeVisible()
    await expect(quickRange(page, "Next 7 days")).toBeChecked()
    await expect(page.getByLabel("From date")).toHaveValue("2026-10-21")
    await expect(page.getByLabel("To date")).toHaveValue("2026-10-27")
    // Fixed services have no length to fit.
    await expect(page.getByText("Length to fit")).toHaveCount(0)
  })

  test("requires a location when there are several", async ({ page, api, net }) => {
    await gotoSlots(page, api, haircut.name)
    await slotsForm(page).getByRole("button", { name: "Find slots" }).click()
    await expect(slotsForm(page).getByText("Select a location")).toBeVisible()
    await expect(slotsForm(page).getByRole("combobox", { name: "Location" })).toHaveAttribute("aria-invalid", "true")
    expect(net.find("GET", /bookable-slots$/)).toHaveLength(0)

    await pickSlotsLocation(page, STOCKHOLM)
    await expect(slotsForm(page).getByText("Select a location")).toHaveCount(0)
    await expect(slotsForm(page).getByText("Times are shown in Europe/Stockholm.")).toBeVisible()
  })

  test("validates the date range", async ({ page, api, net }) => {
    await gotoSlots(page, api, haircut.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await page.getByLabel("From date").fill("2026-10-25")
    // Typing a date leaves the preset.
    await expect(quickRange(page, "Next 7 days")).not.toBeChecked()
    await page.getByLabel("To date").fill("2026-10-22")
    await slotsForm(page).getByRole("button", { name: "Find slots" }).click()
    await expect(slotsForm(page).getByText("The end date must be on or after the start date")).toBeVisible()
    await expect(page.getByLabel("From date")).toHaveAttribute("aria-invalid", "true")

    await page.getByLabel("From date").fill("")
    await expect(slotsForm(page).getByText("Pick a start and end date")).toBeVisible()
    expect(net.find("GET", /bookable-slots$/)).toHaveLength(0)

    await quickRange(page, "Today").click()
    await expect(slotsForm(page).getByText("Pick a start and end date")).toHaveCount(0)
    await expect(page.getByLabel("From date")).toHaveValue("2026-10-21")
    await expect(page.getByLabel("To date")).toHaveValue("2026-10-21")
  })

  test("validates the number of free resources", async ({ page, api, net }) => {
    await gotoSlots(page, api, haircut.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await slotsForm(page).getByRole("spinbutton", { name: "Free resources" }).fill("0")
    await slotsForm(page).getByRole("button", { name: "Find slots" }).click()
    await expect(slotsForm(page).getByText("Enter a whole number of at least 1")).toBeVisible()
    expect(net.find("GET", /bookable-slots$/)).toHaveLength(0)
  })

  test("the Resource field only offers associated resources", async ({ page, api }) => {
    await gotoSlots(page, api, equipment.name)
    const resource = slotsForm(page).getByRole("combobox", { name: "Resource" })
    await expect(resource).toHaveText("Any associated resource")
    await resource.click()
    await expect(page.locator('[data-slot="popover-content"]').last().getByRole("option")).toHaveText([roomA.name])
  })

  test("shows a loading state while searching", async ({ page, api, net }) => {
    await gotoSlots(page, api, haircut.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await net.delay(/bookable-slots$/, 1_000)
    const button = slotsForm(page).getByRole("button", { name: "Find slots" })
    await button.click()
    await expect(page.getByLabel("Loading slots")).toBeVisible()
    await expect(button).toHaveAttribute("aria-busy", "true")
    await expect(button).toBeDisabled()
    await expect(slotsSummary(page)).toBeVisible()
    await expect(button).toHaveAttribute("aria-busy", "false")
  })
})

test.describe("bookable slots: fixed service", () => {
  test("Haircut at Stockholm for the next 7 days", async ({ page, api }) => {
    const { params } = await searchSlots(page, api, haircut.name)
    await expect(slotsSummary(page)).toHaveText("40 slots · times in Europe/Stockholm")
    expect(params.get("location")).toBe(await api.idOf("locations", STOCKHOLM))
    expect(params.get("from")).toBe("2026-10-21T00:00:00+02:00")
    expect(params.get("to")).toBe("2026-10-28T00:00:00+01:00")
    expect(params.get("per_page")).toBe("100")
    expect(params.has("duration")).toBe(false)
    expect(params.has("ignore_booking_window")).toBe(false)

    await expect(page.getByRole("heading", { name: /^Today, Wednesday 21 October 2026\s*8 slots$/ })).toBeVisible()
    await expect(page.getByRole("heading", { name: /^Tomorrow, Thursday 22 October 2026/ })).toBeVisible()
    await expect(page.getByRole("heading", { name: /^Monday 26 October 2026/ })).toBeVisible()
    // No opening hours at the weekend.
    await expect(slotDay(page, "Saturday 24 October 2026")).toHaveCount(0)

    const today = slotDay(page, "Wednesday 21 October 2026")
    await expect(today.getByRole("listitem")).toHaveCount(8)
    const first = slotRow(today, "09:00 – 09:45")
    await expect(first).toContainText("Blocked 09:00 – 10:00 with buffers")
    await expect(slotBadges(first)).toHaveText([anna.name, ben.name, roomA.name])
    await expect(slotRow(today, "16:00 – 16:45")).toBeVisible()
  })

  test("a booked resource is left out of the slot", async ({ page, api }) => {
    await searchSlots(page, api, haircut.name)
    const thursday = slotDay(page, "Thursday 22 October 2026")
    // Erik Lund has Anna at 09:00, Nora Falk has Ben at 14:00.
    await expect(slotBadges(slotRow(thursday, "09:00 – 09:45"))).toHaveText([ben.name, roomA.name])
    await expect(slotBadges(slotRow(thursday, "10:00 – 10:45"))).toHaveText([anna.name, ben.name, roomA.name])
    await expect(slotBadges(slotRow(thursday, "14:00 – 14:45"))).toHaveText([anna.name, roomA.name])
    // Ben is blocked on Tuesday morning and Ida Strand has Anna at 10:00.
    await expect(slotBadges(slotRow(slotDay(page, "Tuesday 27 October 2026"), "10:00 – 10:45"))).toHaveText([roomA.name])
  })

  test("a slot with one resource links straight to the booking form", async ({ page, api }) => {
    const { service } = await searchSlots(page, api, haircut.name)
    const row = slotRow(slotDay(page, "Tuesday 27 October 2026"), "10:00 – 10:45")
    const link = row.getByRole("link", { name: "Book" })
    const { href, params } = await hrefParams(link)
    expect(href).toContain("starts_at=2026-10-27T10%3A00%3A00%2B01%3A00")
    expect(href).toContain("ends_at=2026-10-27T10%3A45%3A00%2B01%3A00")
    expect(params.get("service")).toBe(service.id)
    expect(params.get("location")).toBe(await api.idOf("locations", STOCKHOLM))
    expect(params.get("resource")).toBe(await api.idOf("resources", roomA.name))
  })

  test("a slot with several resources offers a Book menu", async ({ page, api }) => {
    await searchSlots(page, api, haircut.name)
    const row = slotRow(slotDay(page, "Wednesday 21 October 2026"), "09:00 – 09:45")
    await expect(row.getByRole("link", { name: "Book" })).toHaveCount(0)
    await row.getByRole("button", { name: "Book" }).click()
    const menu = page.getByRole("menu")
    await expect(menu.getByRole("menuitem")).toHaveText(["Any available (auto-select)", anna.name, ben.name, roomA.name])
    await expect(menu.getByText("Specific resource")).toBeVisible()

    const any = await hrefParams(menu.getByRole("menuitem", { name: "Any available (auto-select)" }))
    expect(any.href).toContain("starts_at=2026-10-21T09%3A00%3A00%2B02%3A00")
    expect(any.href).toContain("ends_at=2026-10-21T09%3A45%3A00%2B02%3A00")
    expect(any.params.has("resource")).toBe(false)
    const ben_ = await hrefParams(menu.getByRole("menuitem", { name: ben.name }))
    expect(ben_.params.get("resource")).toBe(await api.idOf("resources", ben.name))
    expect(ben_.params.get("starts_at")).toBe("2026-10-21T09:00:00+02:00")
  })

  test("filtering by resource sends it and links every slot to it", async ({ page, api }) => {
    await gotoSlots(page, api, haircut.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await pickSlotsResource(page, anna.name)
    const params = await findSlots(page)
    const annaId = await api.idOf("resources", anna.name)
    expect(params.get("resource")).toBe(annaId)
    // Erik Lund's booking removes Anna's Thursday 09:00 slot.
    await expect(slotsSummary(page)).toHaveText("38 slots · times in Europe/Stockholm")
    const row = slotRow(slotDay(page, "Wednesday 21 October 2026"), "09:00 – 09:45")
    const { href } = await hrefParams(row.getByRole("link", { name: "Book" }))
    expect(href).toContain(`resource=${annaId}`)
    expect(href).toContain("starts_at=2026-10-21T09%3A00%3A00%2B02%3A00")

    await slotsForm(page).getByRole("button", { name: "Clear selection" }).click()
    await expect(slotsForm(page).getByRole("combobox", { name: "Resource" })).toHaveText("Any associated resource")
  })

  test("Today and Next 30 days presets, then Load more", async ({ page, api }) => {
    await gotoSlots(page, api, haircut.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await quickRange(page, "Today").click()
    let params = await findSlots(page)
    expect(params.get("from")).toBe("2026-10-21T00:00:00+02:00")
    expect(params.get("to")).toBe("2026-10-22T00:00:00+02:00")
    await expect(slotsSummary(page)).toHaveText("8 slots · times in Europe/Stockholm")
    await expect(page.getByRole("heading", { name: /^Tomorrow/ })).toHaveCount(0)

    await quickRange(page, "Next 30 days").click()
    params = await findSlots(page)
    expect(params.get("to")).toBe("2026-11-20T00:00:00+01:00")
    await expect(slotsSummary(page)).toHaveText("Showing 100 of 176 slots · times in Europe/Stockholm")
    const next = slotRequest(page)
    await page.getByRole("button", { name: "Load more" }).click()
    expect(new URL((await next).url()).searchParams.get("page")).toBe("2")
    await expect(slotsSummary(page)).toHaveText("176 slots · times in Europe/Stockholm")
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: /^Thursday 19 November 2026/ })).toBeVisible()
  })

  test("a failed Load more keeps the first page and shows the error", async ({ page, api }) => {
    await page.route(
      (url) => url.pathname.endsWith("/bookable-slots") && url.searchParams.get("page") === "2",
      (route) =>
        route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ message: "Page out of range." }) })
    )
    await gotoSlots(page, api, haircut.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await quickRange(page, "Next 30 days").click()
    await findSlots(page)
    await page.getByRole("button", { name: "Load more" }).click()
    const alert = page.getByRole("alert").filter({ hasText: "Couldn't load more slots" })
    await expect(alert).toContainText("Page out of range.")
    await expect(slotsSummary(page)).toHaveText("Showing 100 of 176 slots · times in Europe/Stockholm")
  })

  test("a custom date range", async ({ page, api }) => {
    await gotoSlots(page, api, haircut.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await page.getByLabel("From date").fill("2026-10-26")
    await page.getByLabel("To date").fill("2026-10-26")
    const params = await findSlots(page)
    expect(params.get("from")).toBe("2026-10-26T00:00:00+01:00")
    expect(params.get("to")).toBe("2026-10-27T00:00:00+01:00")
    await expect(slotsSummary(page)).toHaveText("8 slots · times in Europe/Stockholm")
    await expect(page.getByRole("heading", { name: /^Monday 26 October 2026/ })).toBeVisible()
  })

  test("a weekend-only range has no slots", async ({ page, api }) => {
    await gotoSlots(page, api, haircut.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await page.getByLabel("From date").fill("2026-10-24")
    await page.getByLabel("To date").fill("2026-10-25")
    await findSlots(page)
    await expect(page.getByText("No bookable slots")).toBeVisible()
    await expect(page.getByText("Nothing is free in this range.")).toBeVisible()
  })

  test("Free resources filters slots", async ({ page, api }) => {
    await gotoSlots(page, api, haircut.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await slotsForm(page).getByRole("spinbutton", { name: "Free resources" }).fill("2")
    const params = await findSlots(page)
    expect(params.get("num_resources")).toBe("2")
    await expect(slotsSummary(page)).toHaveText("39 slots · times in Europe/Stockholm")
    await expect(slotRow(slotDay(page, "Tuesday 27 October 2026"), "10:00 – 10:45")).toHaveCount(0)
    await expect(slotRow(slotDay(page, "Tuesday 27 October 2026"), "11:00 – 11:45")).toBeVisible()
  })

  test("Ignore booking window brings back slots inside the minimum notice", async ({ page, api }) => {
    const id = await api.idOf("services", haircut.name)
    await api.patch(`services/${id}`, { booking_window_start: "P1D" })
    await searchSlots(page, api, haircut.name)
    await expect(slotsSummary(page)).toHaveText("32 slots · times in Europe/Stockholm")
    await expect(page.getByRole("heading", { name: /^Today/ })).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 3 }).first()).toHaveText(/^Tomorrow, Thursday 22 October 2026/)

    await slotsForm(page).getByRole("switch", { name: "Ignore booking window" }).click()
    const params = await findSlots(page)
    expect(params.get("ignore_booking_window")).toBe("true")
    await expect(slotsSummary(page)).toHaveText("40 slots · times in Europe/Stockholm")
    await expect(page.getByRole("heading", { name: /^Today, Wednesday 21 October 2026/ })).toBeVisible()
  })

  test("searching again with the same parameters refetches", async ({ page, api, net }) => {
    await searchSlots(page, api, haircut.name)
    await expect(slotsSummary(page)).toBeVisible()
    expect(net.find("GET", /bookable-slots$/)).toHaveLength(1)
    const again = slotRequest(page)
    await slotsForm(page).getByRole("button", { name: "Find slots" }).click()
    await again
    expect(net.find("GET", /bookable-slots$/)).toHaveLength(2)
    await expect(slotsSummary(page)).toHaveText("40 slots · times in Europe/Stockholm")
  })

  test("a New York location shows New York times", async ({ page, api }) => {
    const { params } = await searchSlots(page, api, haircut.name, NEW_YORK)
    // The days run midnight to midnight in New York.
    expect(params.get("from")).toBe("2026-10-21T00:00:00-04:00")
    expect(params.get("to")).toBe("2026-10-28T00:00:00-04:00")
    await expect(slotsForm(page).getByText("Times are shown in America/New_York.")).toBeVisible()
    await expect(slotsSummary(page)).toHaveText("40 slots · times in America/New_York")
    const row = slotRow(slotDay(page, "Wednesday 21 October 2026"), "09:00 – 09:45")
    await expect(slotBadges(row)).toHaveText([anna.name])
    const { href } = await hrefParams(row.getByRole("link", { name: "Book" }))
    expect(href).toContain("starts_at=2026-10-21T09%3A00%3A00-04%3A00")
  })

  test("a rejected search shows the error with a hint", async ({ page, api, net }) => {
    await net.fail(/bookable-slots$/, {
      method: "GET",
      status: 422,
      body: { message: "The given data was invalid.", errors: { to: ["The to must be a date after from."] } },
    })
    await searchSlots(page, api, haircut.name)
    const alert = page.getByRole("alert").filter({ hasText: "Couldn't load bookable slots" })
    await expect(alert).toContainText("The to must be a date after from.")
    await expect(page.getByText("Hapio rejected the search. Check the dates, length and number of resources.")).toBeVisible()
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible()
  })

  test("a missing service or location shows a not-found hint and can retry", async ({ page, api, net }) => {
    await net.fail(/bookable-slots$/, { method: "GET", status: 404, body: { message: "Not found." }, times: 1 })
    await searchSlots(page, api, haircut.name)
    const alert = page.getByRole("alert").filter({ hasText: "Couldn't load bookable slots" })
    await expect(alert).toBeVisible()
    await expect(page.getByText("The service, location or resource wasn't found. It may have been deleted.")).toBeVisible()
    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(slotsSummary(page)).toHaveText("40 slots · times in Europe/Stockholm")
  })

  test("a Book link opens the booking form prefilled", async ({ page, api }) => {
    await gotoSlots(page, api, haircut.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await pickSlotsResource(page, ben.name)
    await findSlots(page)
    const row = slotRow(slotDay(page, "Thursday 22 October 2026"), "10:00 – 10:45")
    await row.getByRole("link", { name: "Book" }).click()
    await expect(page).toHaveURL(/\/bookings\/new\?/)
    await expect(page.getByRole("heading", { level: 1, name: "New booking" })).toBeVisible()
    await expect(page.getByText("Prefilled from your selection.", { exact: false })).toBeVisible()
    const main = page.getByRole("main")
    await expect(main.getByRole("combobox", { name: "Service" })).toHaveText(haircut.name)
    await expect(main.getByRole("combobox", { name: "Location" })).toHaveText(STOCKHOLM)
    await expect(main.getByRole("combobox", { name: "Resource" })).toHaveText(ben.name)
    await expect(main.getByLabel("Starts", { exact: true })).toHaveValue("2026-10-22T10:00")
    await expect(main.getByLabel("Ends", { exact: true })).toHaveValue("2026-10-22T10:45")
  })
})

test.describe("bookable slots: after lunch", () => {
  test.use({ now: NOW_MIDDAY })

  test("today's first slot is the next one that hasn't started", async ({ page, api }) => {
    await searchSlots(page, api, haircut.name)
    const today = slotDay(page, "Wednesday 21 October 2026")
    await expect(today.getByRole("listitem").first()).toContainText("13:00 – 13:45")
    await expect(today.getByRole("listitem")).toHaveCount(4)
    await expect(slotsSummary(page)).toHaveText("36 slots · times in Europe/Stockholm")
  })
})

test.describe("bookable slots: flexible service", () => {
  test("Studio rental offers ends in steps from the minimum to the maximum", async ({ page, api }) => {
    await gotoSlots(page, api, studio.name)
    await expect(slotsForm(page).getByRole("switch", { name: "Service minimum" })).toBeChecked()
    await pickSlotsLocation(page, STOCKHOLM)
    const params = await findSlots(page)
    expect(params.has("duration")).toBe(false)

    const today = slotDay(page, "Wednesday 21 October 2026")
    await expect(page.getByRole("heading", { name: /^Today, Wednesday 21 October 2026\s*15 slots$/ })).toBeVisible()
    // Find the row by its start: its end changes with the chosen end.
    const row = slotRow(today, "09:00 – ")
    await expect(row.locator("p").first()).toHaveText("09:00 – 10:001 h")
    await expect(row).toContainText("Can end between 10:00 and 13:00")
    await expect(row).not.toContainText("Blocked")

    const end = row.getByRole("combobox", { name: "Booking end" })
    await end.click()
    await expect(options(page)).toHaveText([
      "Ends 10:00· 1 h",
      "Ends 10:30· 1 h 30 min",
      "Ends 11:00· 2 h",
      "Ends 11:30· 2 h 30 min",
      "Ends 12:00· 3 h",
      "Ends 12:30· 3 h 30 min",
      "Ends 13:00· 4 h",
    ])
    await options(page).filter({ hasText: "Ends 11:30" }).click()
    await expect(row.locator("p").first()).toHaveText("09:00 – 11:302 h 30 min")

    await row.getByRole("button", { name: "Book" }).click()
    const item = page.getByRole("menu").getByRole("menuitem", { name: anna.name })
    const { href } = await hrefParams(item)
    expect(href).toContain("starts_at=2026-10-21T09%3A00%3A00%2B02%3A00")
    expect(href).toContain("ends_at=2026-10-21T11%3A30%3A00%2B02%3A00")
  })

  test("Length to fit sends a duration", async ({ page, api }) => {
    await gotoSlots(page, api, studio.name)
    await pickSlotsLocation(page, STOCKHOLM)
    const form = slotsForm(page)
    await form.getByRole("switch", { name: "Service minimum" }).click()
    // Starts from the service's default (or minimum) length.
    await expect(form.getByRole("spinbutton", { name: "Hours" })).toHaveValue("1")
    await form.getByRole("spinbutton", { name: "Hours" }).fill("2")
    const params = await findSlots(page)
    expect(params.get("duration")).toBe("PT2H")
    // Slots must leave room for 2 h, so the last one today starts at 15:00.
    await expect(page.getByRole("heading", { name: /^Today, Wednesday 21 October 2026\s*13 slots$/ })).toBeVisible()
    await expect(slotDay(page, "Wednesday 21 October 2026").getByRole("listitem").last()).toContainText("15:00 – 16:00")
  })

  test("Length to fit must be longer than zero", async ({ page, api, net }) => {
    await gotoSlots(page, api, studio.name)
    await pickSlotsLocation(page, STOCKHOLM)
    const form = slotsForm(page)
    await form.getByRole("switch", { name: "Service minimum" }).click()
    await form.getByRole("spinbutton", { name: "Hours" }).fill("0")
    await form.getByRole("button", { name: "Find slots" }).click()
    await expect(form.getByText("Must be longer than zero")).toBeVisible()
    expect(net.find("GET", /bookable-slots$/)).toHaveLength(0)
  })

  test("a slot's chosen end resets when the slot changes on refetch", async ({ page, api }) => {
    await gotoSlots(page, api, studio.name)
    await pickSlotsLocation(page, STOCKHOLM)
    await pickSlotsResource(page, anna.name)
    await findSlots(page)
    const row = slotRow(slotDay(page, "Wednesday 21 October 2026"), "09:00 – ")
    await expect(row).toContainText("Can end between 10:00 and 13:00")
    await row.getByRole("combobox", { name: "Booking end" }).click()
    await options(page).filter({ hasText: "Ends 13:00" }).click()
    await expect(row.locator("p").first()).toHaveText("09:00 – 13:004 h")

    // Anna becomes unavailable from 12:00, so 13:00 is no longer a valid end.
    const annaId = await api.idOf("resources", anna.name)
    await api.post(`resources/${annaId}/schedule-blocks`, {
      location_id: await api.idOf("locations", STOCKHOLM),
      starts_at: "2026-10-21T12:00:00+02:00",
      ends_at: "2026-10-21T17:00:00+02:00",
      is_available: false,
    })
    await findSlots(page)
    await expect(row).toContainText("Can end between 10:00 and 12:00")
    await expect(row.locator("p").first()).toHaveText("09:00 – 10:001 h")
    await row.getByRole("combobox", { name: "Booking end" }).click()
    await expect(options(page)).toHaveText([
      "Ends 10:00· 1 h",
      "Ends 10:30· 1 h 30 min",
      "Ends 11:00· 2 h",
      "Ends 11:30· 2 h 30 min",
      "Ends 12:00· 3 h",
    ])
    await page.keyboard.press("Escape")
    const { href } = await hrefParams(row.getByRole("link", { name: "Book" }))
    expect(href).toContain("ends_at=2026-10-21T10%3A00%3A00%2B02%3A00")
  })
})

test.describe("bookable slots: day service", () => {
  test("Equipment rental shows end dates and keeps 17:00 across the DST change", async ({ page, api }) => {
    const roomAId = await api.idOf("resources", roomA.name)
    const location = await api.idOf("locations", STOCKHOLM)
    // Open Room A over the weekend so a Friday rental can run into next week.
    for (const [start, end] of [
      ["2026-10-24T09:00:00+02:00", "2026-10-24T17:00:00+02:00"],
      ["2026-10-25T09:00:00+01:00", "2026-10-25T17:00:00+01:00"],
    ]) {
      await api.post(`resources/${roomAId}/schedule-blocks`, { location_id: location, starts_at: start, ends_at: end, is_available: true })
    }
    await gotoSlots(page, api, equipment.name)
    await expect(slotsForm(page).getByRole("switch", { name: "Service minimum" })).toBeChecked()
    await pickSlotsLocation(page, STOCKHOLM)
    await findSlots(page)
    await expect(slotsSummary(page)).toHaveText("7 slots · times in Europe/Stockholm")

    // Find the row by its start: its end changes with the chosen end.
    const row = slotRow(slotDay(page, "Friday 23 October 2026"), "09:00 – ")
    await expect(row.locator("p").first()).toHaveText("09:00 – 17:00")
    await expect(row).toContainText("Can end between 17:00 and Wed 28 Oct, 17:00")
    await expect(slotBadges(row)).toHaveText([roomA.name])
    await row.getByRole("combobox", { name: "Booking end" }).click()
    await expect(options(page)).toHaveText([
      "Ends 17:00",
      "Ends Sat 24 Oct, 17:00",
      "Ends Sun 25 Oct, 17:00",
      "Ends Mon 26 Oct, 17:00",
      "Ends Tue 27 Oct, 17:00",
      "Ends Wed 28 Oct, 17:00",
    ])
    await options(page).filter({ hasText: "Ends Mon 26 Oct, 17:00" }).click()
    await expect(row.locator("p").first()).toHaveText("09:00 – Mon 26 Oct, 17:00")

    const { href, params } = await hrefParams(row.getByRole("link", { name: "Book" }))
    expect(href).toContain("starts_at=2026-10-23T09%3A00%3A00%2B02%3A00")
    expect(href).toContain("ends_at=2026-10-26T17%3A00%3A00%2B01%3A00")
    expect(params.get("resource")).toBe(roomAId)
  })

  test("a one-day-only slot has no end picker", async ({ page, api }) => {
    await searchSlots(page, api, equipment.name)
    await expect(slotsSummary(page)).toHaveText("5 slots · times in Europe/Stockholm")
    const friday = slotRow(slotDay(page, "Friday 23 October 2026"), "09:00 – 17:00")
    await expect(friday.getByRole("combobox", { name: "Booking end" })).toHaveCount(0)
    await expect(friday).not.toContainText("Can end between")
    await expect(slotRow(slotDay(page, "Wednesday 21 October 2026"), "09:00 – 17:00")).toContainText(
      "Can end between 17:00 and Fri 23 Oct, 17:00"
    )
  })

  test("Length to fit is in days", async ({ page, api }) => {
    await gotoSlots(page, api, equipment.name)
    await pickSlotsLocation(page, STOCKHOLM)
    const form = slotsForm(page)
    await form.getByRole("switch", { name: "Service minimum" }).click()
    await expect(form.getByRole("spinbutton", { name: "Days" })).toHaveValue("1")
    await expect(form.getByRole("spinbutton", { name: "Hours" })).toHaveCount(0)
    await form.getByRole("spinbutton", { name: "Days" }).fill("3")
    const params = await findSlots(page)
    expect(params.get("duration")).toBe("P3D")
  })
})
