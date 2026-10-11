import type { Locator, Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { expectToast } from "../helpers/toasts"
import {
  card,
  detailValue,
  durationGroup,
  field,
  fieldError,
  gotoService,
  setDuration,
  setRawDuration,
} from "./_helpers"

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
const DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

/** Defaults every new service sends besides its type fields. */
const COMMON_DEFAULTS = {
  buffer_time_before: "PT0S",
  buffer_time_after: "PT0S",
  booking_window_start: "PT0S",
  booking_window_end: null,
  cancelation_threshold: "PT0S",
  enabled: true,
  metadata: null,
}

async function openCreate(page: Page) {
  await page.goto("/services")
  await expect(page.getByRole("main").getByRole("table").getByText(SEED.services.haircut.name)).toBeVisible()
  await page.getByRole("button", { name: "New service" }).click()
  const dialog = page.getByRole("dialog", { name: "New service" })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openEdit(page: Page, api: Parameters<typeof gotoService>[1], name: string) {
  const service = await gotoService(page, api, name)
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Edit service" })
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(name)
  return { dialog, service }
}

const nameInput = (dialog: Locator) => dialog.getByRole("textbox", { name: "Name" })
const submit = (dialog: Locator) => dialog.getByRole("button", { name: /^(Create service|Save changes)$/ })
const chooseType = (dialog: Locator, type: "Fixed" | "Flexible" | "Day") =>
  dialog.getByRole("radio", { name: new RegExp(`^${type}\\b`) }).click()

test.describe("service form: fixed", () => {
  test("creates a fixed service sending only fixed fields", async ({ page, net, api }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Massage")
    await expect(durationGroup(dialog, "Duration").getByText("PT1H · 1 h")).toBeVisible()
    await setDuration(dialog, "Duration", { Minutes: 30 })
    await expect(durationGroup(dialog, "Duration").getByText("PT1H30M · 1 h 30 min")).toBeVisible()
    const price = dialog.getByRole("textbox", { name: "Price per booking" })
    await price.fill("149")
    await price.blur()
    await expect(price).toHaveValue("149.000")

    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toEqual({
      type: "fixed",
      name: "Massage",
      ...COMMON_DEFAULTS,
      price: "149.000",
      duration: "PT1H30M",
      bookable_interval: null,
    })
    await expectToast(page, "Service created", { type: "success" })
    const created = await api.byName("services", "Massage")
    await expect(page).toHaveURL(`/services/${created.id}`)
    await expect(page.getByRole("heading", { level: 1, name: "Massage" })).toBeVisible()
  })

  test("name is required and nothing is sent", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await submit(dialog).click()
    await expect(fieldError(dialog, "Name")).toHaveText("Required")
    await nameInput(dialog).fill("  ")
    await expect(fieldError(dialog, "Name")).toHaveText("Required")
    await nameInput(dialog).fill("Massage")
    await expect(fieldError(dialog, "Name")).toHaveCount(0)
    expect(net.find("POST", "services")).toHaveLength(0)
  })

  test("duration switches between the simple editor and ISO 8601", async ({ page }) => {
    const dialog = await openCreate(page)
    const group = durationGroup(dialog, "Duration")
    await expect(group.getByRole("spinbutton", { name: "Days" })).toHaveValue("0")
    await expect(group.getByRole("spinbutton", { name: "Hours" })).toHaveValue("1")
    await expect(group.getByRole("spinbutton", { name: "Minutes" })).toHaveValue("0")

    await group.getByRole("button", { name: "Edit ISO 8601" }).click()
    const raw = group.getByRole("textbox")
    await expect(raw).toHaveValue("PT1H")
    await raw.fill("pt2h15m")
    await expect(raw).toHaveValue("PT2H15M")
    await expect(group.getByText("PT2H15M · 2 h 15 min")).toBeVisible()

    await group.getByRole("button", { name: "Simple editor" }).click()
    await expect(group.getByRole("spinbutton", { name: "Hours" })).toHaveValue("2")
    await expect(group.getByRole("spinbutton", { name: "Minutes" })).toHaveValue("15")

    // Weeks can't be shown in the simple editor, so raw mode is forced.
    await group.getByRole("button", { name: "Edit ISO 8601" }).click()
    await raw.fill("P2W")
    await expect(group.getByText("P2W · 2 weeks")).toBeVisible()
    await expect(group.getByRole("button", { name: "Simple editor" })).toBeDisabled()
  })

  test("invalid and zero durations are rejected", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Massage")
    const raw = await setRawDuration(dialog, "Duration", "PT1.5H")
    await expect(durationGroup(dialog, "Duration").getByText("Not a valid ISO 8601 duration", { exact: true })).toBeVisible()
    await expect(raw).toHaveAttribute("aria-invalid", "true")
    await submit(dialog).click()
    await expect(fieldError(dialog, "Duration")).toHaveText("Not a valid ISO 8601 duration (e.g. PT1H30M)")

    await raw.fill("PT0S")
    await expect(fieldError(dialog, "Duration")).toHaveText("Must be longer than zero")

    await durationGroup(dialog, "Duration").getByRole("button", { name: "Simple editor" }).click()
    await setDuration(dialog, "Duration", { Minutes: 20 })
    await expect(fieldError(dialog, "Duration")).toHaveCount(0)
    await setDuration(dialog, "Duration", { Minutes: 0 })
    await expect(fieldError(dialog, "Duration")).toHaveText("Must be longer than zero")
    expect(net.find("POST", "services")).toHaveLength(0)
  })

  test("a P2W duration opens in raw mode when editing", async ({ page, api }) => {
    const id = await api.idOf("services", SEED.services.haircut.name)
    await api.patch(`services/${id}`, { duration: "P2W" })
    const { dialog } = await openEdit(page, api, SEED.services.haircut.name)
    const group = durationGroup(dialog, "Duration")
    await expect(group.getByRole("textbox")).toHaveValue("P2W")
    await expect(group.getByRole("button", { name: "Simple editor" })).toBeDisabled()
    await expect(group.getByRole("spinbutton")).toHaveCount(0)
  })

  test("bookable interval switches between the default and a value", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Massage")
    await setDuration(dialog, "Duration", { Hours: 0, Minutes: 45 })
    const group = durationGroup(dialog, "Bookable interval")
    const useDefault = group.getByRole("switch", { name: "Default (duration + buffers)" })
    await expect(useDefault).toBeChecked()
    await expect(group.getByRole("spinbutton")).toHaveCount(0)

    // Turning the default off starts from the duration.
    await useDefault.click()
    await expect(useDefault).not.toBeChecked()
    await expect(group.getByText("PT45M · 45 min")).toBeVisible()
    await group.getByRole("spinbutton", { name: "Minutes" }).fill("15")

    let post = net.waitFor("POST", "services")
    await net.fail("services", { method: "POST", status: 500, body: { message: "Try again." }, times: 1 })
    await submit(dialog).click()
    expect((await post).body).toMatchObject({ duration: "PT45M", bookable_interval: "PT15M" })
    // The dialog is modal, so leave the toast open.
    await expectToast(page, "Try again.", { type: "error", close: false })

    await useDefault.click()
    await expect(useDefault).toBeChecked()
    post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toMatchObject({ duration: "PT45M", bookable_interval: null })
  })

  test("zero bookable interval is rejected", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Massage")
    const group = durationGroup(dialog, "Bookable interval")
    await group.getByRole("switch", { name: "Default (duration + buffers)" }).click()
    await group.getByRole("spinbutton", { name: "Hours" }).fill("0")
    await submit(dialog).click()
    await expect(fieldError(dialog, "Bookable interval")).toHaveText("Must be longer than zero")
    expect(net.find("POST", "services")).toHaveLength(0)
  })

  test("price is normalised and invalid prices are rejected", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Massage")
    const price = dialog.getByRole("textbox", { name: "Price per booking" })
    await expect(price).toHaveAttribute("placeholder", "No price")
    await price.fill("12,5")
    await price.blur()
    await expect(price).toHaveValue("12.500")
    await price.fill("abc")
    await price.blur()
    await expect(price).toHaveValue("abc")
    await submit(dialog).click()
    await expect(fieldError(dialog, "Price per booking")).toHaveText(
      "Use a number with up to 12 digits and 3 decimals, e.g. 149.000"
    )
    await price.fill("1234567890123")
    await expect(fieldError(dialog, "Price per booking")).toHaveCount(1)
    await price.fill("")
    await expect(fieldError(dialog, "Price per booking")).toHaveCount(0)
    expect(net.find("POST", "services")).toHaveLength(0)

    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toMatchObject({ price: null })
  })

  test("the price field follows the type", async ({ page }) => {
    const dialog = await openCreate(page)
    await expect(field(dialog, "Price per booking")).toContainText("The price of one booking.")
    await chooseType(dialog, "Flexible")
    await expect(field(dialog, "Hourly rate")).toContainText("per hour")
    await expect(field(dialog, "Hourly rate")).toContainText("Price per hour booked.")
    await chooseType(dialog, "Day")
    await expect(field(dialog, "Daily rate")).toContainText("per day")
    await expect(field(dialog, "Daily rate")).toContainText("Price per day booked.")
  })

  test("buffers, minimum notice, horizon and cancelation threshold", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Massage")
    await setDuration(dialog, "Buffer before", { Minutes: 10 })
    await setDuration(dialog, "Buffer after", { Minutes: 5 })
    await setDuration(dialog, "Minimum notice", { Hours: 2 })
    await setDuration(dialog, "Cancelation threshold", { Days: 1 })

    const horizon = durationGroup(dialog, "Booking horizon")
    const noLimit = horizon.getByRole("switch", { name: "No limit" })
    await expect(noLimit).toBeChecked()
    await noLimit.click()
    await expect(horizon.getByRole("spinbutton", { name: "Days" })).toHaveValue("30")
    await horizon.getByRole("spinbutton", { name: "Days" }).fill("0")
    await submit(dialog).click()
    await expect(fieldError(dialog, "Booking horizon")).toHaveText("Must be longer than zero")
    expect(net.find("POST", "services")).toHaveLength(0)

    await horizon.getByRole("spinbutton", { name: "Days" }).fill("7")
    await expect(fieldError(dialog, "Booking horizon")).toHaveCount(0)
    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toMatchObject({
      buffer_time_before: "PT10M",
      buffer_time_after: "PT5M",
      booking_window_start: "PT2H",
      booking_window_end: "P7D",
      cancelation_threshold: "P1D",
    })
    await expectToast(page, "Service created")
  })

  test("metadata is sent as JSON and must be an object", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Massage")
    const metadata = dialog.getByRole("textbox", { name: "Metadata", exact: true })
    await metadata.fill("[1, 2]")
    await submit(dialog).click()
    await expect(fieldError(dialog, "Metadata")).toHaveText("Metadata must be a JSON object.")
    await metadata.fill('{ "category": "spa" }')
    await dialog.getByRole("textbox", { name: "Protected metadata" }).fill('{ "cost": 12 }')
    await expect(fieldError(dialog, "Metadata")).toHaveCount(0)
    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toMatchObject({ metadata: { category: "spa" }, protected_metadata: { cost: 12 } })
  })

  test("a disabled service can be created", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Massage")
    await dialog.getByRole("switch", { name: "Enabled" }).click()
    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toMatchObject({ enabled: false })
    await expect(page.getByRole("heading", { level: 1, name: "Massage" })).toBeVisible()
    // The list page stays mounted (hidden) after navigating, so only look at visible text.
    await expect(page.getByRole("main").getByText("Disabled", { exact: true }).filter({ visible: true })).toBeVisible()
  })

  test("switching type keeps what was typed for each type", async ({ page }) => {
    const dialog = await openCreate(page)
    await setDuration(dialog, "Duration", { Hours: 3 })
    await chooseType(dialog, "Flexible")
    await expect(durationGroup(dialog, "Duration")).toHaveCount(0)
    await setDuration(dialog, "Minimum length", { Hours: 2, Minutes: 0 })
    await chooseType(dialog, "Fixed")
    await expect(durationGroup(dialog, "Duration").getByRole("spinbutton", { name: "Hours" })).toHaveValue("3")
    await chooseType(dialog, "Flexible")
    await expect(durationGroup(dialog, "Minimum length").getByRole("spinbutton", { name: "Hours" })).toHaveValue("2")
  })

  test("whitespace-only protected metadata is left out of the request", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Massage")
    await dialog.getByRole("textbox", { name: "Protected metadata" }).fill("   ")
    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).not.toHaveProperty("protected_metadata")
  })

  test("Cancel discards what was typed", async ({ page }) => {
    let dialog = await openCreate(page)
    await nameInput(dialog).fill("Draft")
    await chooseType(dialog, "Day")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole("button", { name: "New service" }).click()
    dialog = page.getByRole("dialog", { name: "New service" })
    await expect(nameInput(dialog)).toHaveValue("")
    await expect(dialog.getByRole("radio", { name: /^Fixed\b/ })).toBeChecked()
  })
})

test.describe("service form: flexible", () => {
  test("creates a flexible service", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Court rental")
    await chooseType(dialog, "Flexible")
    await expect(durationGroup(dialog, "Maximum length").getByRole("switch", { name: "No maximum" })).not.toBeChecked()
    await expect(durationGroup(dialog, "Default length").getByRole("switch", { name: "No default" })).toBeChecked()
    await expect(durationGroup(dialog, "Bookable interval").getByRole("switch", { name: "Same as step" })).toBeChecked()
    await setDuration(dialog, "Minimum length", { Hours: 1, Minutes: 0 })
    await setDuration(dialog, "Step", { Minutes: 15 })
    const defaultLength = durationGroup(dialog, "Default length")
    await defaultLength.getByRole("switch", { name: "No default" }).click()
    // Turning "No default" off starts from the minimum.
    await expect(defaultLength.getByText("PT1H · 1 h")).toBeVisible()
    await defaultLength.getByRole("spinbutton", { name: "Minutes" }).fill("30")
    await dialog.getByRole("textbox", { name: "Hourly rate" }).fill("300")

    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toEqual({
      type: "flexible",
      name: "Court rental",
      ...COMMON_DEFAULTS,
      price: "300.000",
      min_duration: "PT1H",
      max_duration: "PT4H",
      default_duration: "PT1H30M",
      duration_step: "PT15M",
      bookable_interval: null,
    })
    await expectToast(page, "Service created")
    await expect(page.getByRole("heading", { level: 1, name: "Court rental" })).toBeVisible()
  })

  test("no maximum is sent as null", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Open-ended")
    await chooseType(dialog, "Flexible")
    await durationGroup(dialog, "Maximum length").getByRole("switch", { name: "No maximum" }).click()
    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toMatchObject({ max_duration: null, min_duration: "PT30M" })
  })

  test("maximum below minimum and a default outside the range are rejected", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Court rental")
    await chooseType(dialog, "Flexible")
    await setDuration(dialog, "Minimum length", { Hours: 2, Minutes: 0 })
    await setDuration(dialog, "Maximum length", { Hours: 1 })
    await submit(dialog).click()
    await expect(fieldError(dialog, "Maximum length")).toHaveText("Must be at least the minimum length")

    await setDuration(dialog, "Maximum length", { Hours: 4 })
    await expect(fieldError(dialog, "Maximum length")).toHaveCount(0)
    const defaultLength = durationGroup(dialog, "Default length")
    await defaultLength.getByRole("switch", { name: "No default" }).click()
    await defaultLength.getByRole("spinbutton", { name: "Hours" }).fill("5")
    await expect(fieldError(dialog, "Default length")).toHaveText("Must be between the minimum and maximum length")
    await defaultLength.getByRole("spinbutton", { name: "Hours" }).fill("1")
    await expect(fieldError(dialog, "Default length")).toHaveText("Must be between the minimum and maximum length")
    await defaultLength.getByRole("spinbutton", { name: "Hours" }).fill("3")
    await expect(fieldError(dialog, "Default length")).toHaveCount(0)
    expect(net.find("POST", "services")).toHaveLength(0)
  })

  test("a zero step is rejected", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Court rental")
    await chooseType(dialog, "Flexible")
    await setDuration(dialog, "Step", { Minutes: 0 })
    await submit(dialog).click()
    await expect(fieldError(dialog, "Step")).toHaveText("Must be longer than zero")
    expect(net.find("POST", "services")).toHaveLength(0)
  })
})

test.describe("service form: day", () => {
  test("creates a day service with the same times every day", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Bike rental")
    await chooseType(dialog, "Day")
    const mode = dialog.getByRole("radiogroup", { name: "Start and end times" })
    await expect(mode.getByRole("radio", { name: "Same times every day" })).toBeChecked()
    await expect(dialog.getByLabel("Start time", { exact: true })).toHaveValue("09:00")
    await expect(dialog.getByLabel("End time", { exact: true })).toHaveValue("17:00")
    await dialog.getByLabel("Start time", { exact: true }).fill("08:30")
    await expect(dialog.getByRole("spinbutton", { name: "Minimum days" })).toHaveValue("1")
    await dialog.getByRole("spinbutton", { name: "Maximum days" }).fill("5")
    await dialog.getByRole("spinbutton", { name: "Default days" }).fill("2")
    await dialog.getByRole("textbox", { name: "Daily rate" }).fill("150")

    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toEqual({
      type: "day",
      name: "Bike rental",
      ...COMMON_DEFAULTS,
      price: "150.000",
      start_time: "08:30:00",
      end_time: "17:00:00",
      min_days: 1,
      max_days: 5,
      default_days: 2,
    })
    await expectToast(page, "Service created")
  })

  test("empty maximum and default days are sent as null", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Bike rental")
    await chooseType(dialog, "Day")
    await expect(dialog.getByRole("spinbutton", { name: "Maximum days" })).toHaveAttribute("placeholder", "No limit")
    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toMatchObject({ min_days: 1, max_days: null, default_days: null })
  })

  test("per-weekday times are sent Monday to Sunday", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Bike rental")
    await chooseType(dialog, "Day")
    await dialog.getByLabel("Start time", { exact: true }).fill("08:00")
    await dialog.getByRole("radio", { name: "Per weekday" }).click()
    await expect(dialog.getByLabel("Start time", { exact: true })).toHaveCount(0)
    // The single times carry over to every weekday.
    for (const day of DAY_LABELS) {
      await expect(dialog.getByLabel(`${day} start time`)).toHaveValue("08:00")
      await expect(dialog.getByLabel(`${day} end time`)).toHaveValue("17:00")
    }
    await dialog.getByLabel("Saturday start time").fill("10:00")
    await dialog.getByLabel("Sunday end time").fill("15:00")

    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    const body = (await post).body as { start_time: Record<string, string>; end_time: Record<string, string> }
    expect(Object.keys(body.start_time)).toEqual(WEEKDAYS)
    expect(Object.keys(body.end_time)).toEqual(WEEKDAYS)
    expect(body.start_time).toEqual({
      monday: "08:00:00",
      tuesday: "08:00:00",
      wednesday: "08:00:00",
      thursday: "08:00:00",
      friday: "08:00:00",
      saturday: "10:00:00",
      sunday: "08:00:00",
    })
    expect(body.end_time.sunday).toBe("15:00:00")
    expect(body.end_time.monday).toBe("17:00:00")
    await expectToast(page, "Service created")
  })

  test("Copy Monday to all days", async ({ page }) => {
    const dialog = await openCreate(page)
    await chooseType(dialog, "Day")
    await dialog.getByRole("radio", { name: "Per weekday" }).click()
    await dialog.getByLabel("Monday start time").fill("07:15")
    await dialog.getByLabel("Monday end time").fill("16:45")
    await dialog.getByLabel("Thursday start time").fill("11:00")
    await dialog.getByRole("button", { name: "Copy Monday to all days" }).click()
    for (const day of DAY_LABELS) {
      await expect(dialog.getByLabel(`${day} start time`)).toHaveValue("07:15")
      await expect(dialog.getByLabel(`${day} end time`)).toHaveValue("16:45")
    }
  })

  test("switching back to same times keeps the single times", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Bike rental")
    await chooseType(dialog, "Day")
    await dialog.getByRole("radio", { name: "Per weekday" }).click()
    await dialog.getByLabel("Monday start time").fill("06:00")
    await dialog.getByRole("radio", { name: "Same times every day" }).click()
    await expect(dialog.getByLabel("Start time", { exact: true })).toHaveValue("09:00")
    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toMatchObject({ start_time: "09:00:00", end_time: "17:00:00" })
  })

  test("times and day counts are validated", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Bike rental")
    await chooseType(dialog, "Day")
    await dialog.getByLabel("Start time", { exact: true }).fill("")
    await dialog.getByRole("spinbutton", { name: "Minimum days" }).fill("0")
    await dialog.getByRole("spinbutton", { name: "Default days" }).fill("1.5")
    await submit(dialog).click()
    await expect(fieldError(dialog, "Start time")).toHaveText("Required")
    await expect(fieldError(dialog, "Minimum days")).toHaveText("Enter a whole number of at least 1")
    await expect(fieldError(dialog, "Default days")).toHaveText("Enter a whole number of at least 1, or leave empty")

    await dialog.getByLabel("Start time", { exact: true }).fill("09:00")
    await dialog.getByRole("spinbutton", { name: "Minimum days" }).fill("3")
    await dialog.getByRole("spinbutton", { name: "Maximum days" }).fill("2")
    await dialog.getByRole("spinbutton", { name: "Default days" }).fill("1")
    await expect(fieldError(dialog, "Start time")).toHaveCount(0)
    await expect(fieldError(dialog, "Maximum days")).toHaveText("Must be at least the minimum days")
    await expect(fieldError(dialog, "Default days")).toHaveText("Must be between the minimum and maximum days")

    await dialog.getByRole("spinbutton", { name: "Minimum days" }).fill("")
    await expect(fieldError(dialog, "Minimum days")).toHaveText("Required")
    expect(net.find("POST", "services")).toHaveLength(0)
  })

  test("per-weekday times are validated per row", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Bike rental")
    await chooseType(dialog, "Day")
    await dialog.getByRole("radio", { name: "Per weekday" }).click()
    await dialog.getByLabel("Wednesday start time").fill("")
    await dialog.getByLabel("Friday end time").fill("")
    await submit(dialog).click()
    await expect(dialog.getByRole("alert").filter({ hasText: "Start: Required" })).toHaveCount(1)
    await expect(dialog.getByRole("alert").filter({ hasText: "End: Required" })).toHaveCount(1)
    await dialog.getByLabel("Wednesday start time").fill("09:00")
    await expect(dialog.getByRole("alert").filter({ hasText: "Start: Required" })).toHaveCount(0)
    expect(net.find("POST", "services")).toHaveLength(0)
  })

  test("bookings can end at the end of the day", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Bike rental")
    await chooseType(dialog, "Day")
    const endOfDay = field(dialog, "End time").getByRole("checkbox", { name: "End of day (24:00)" })
    await expect(endOfDay).not.toBeChecked()
    await endOfDay.click()
    await expect(endOfDay).toBeChecked()
    await expect(dialog.getByLabel("End time", { exact: true })).toBeDisabled()
    // Only the end can be at 24:00.
    await expect(field(dialog, "Start time").getByRole("checkbox")).toHaveCount(0)
    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    expect((await post).body).toMatchObject({ start_time: "09:00:00", end_time: "24:00:00" })
    await expectToast(page, "Service created")
    await expect(detailValue(card(page, "Booking length"), "End time")).toHaveText("24:00")
  })

  test("a weekday can end at the end of the day", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Bike rental")
    await chooseType(dialog, "Day")
    await dialog.getByRole("radio", { name: "Per weekday" }).click()
    // One checkbox per weekday, after its end time.
    const checkboxes = dialog.getByRole("checkbox", { name: "End of day (24:00)" })
    await expect(checkboxes).toHaveCount(7)
    await checkboxes.nth(4).click()
    await expect(dialog.getByLabel("Friday end time")).toBeDisabled()
    const post = net.waitFor("POST", "services")
    await submit(dialog).click()
    const body = (await post).body as { end_time: Record<string, string> }
    expect(body.end_time).toEqual({ ...Object.fromEntries(WEEKDAYS.map((d) => [d, "17:00:00"])), friday: "24:00:00" })
  })

  test("a 422 on start_time.monday shows under Start time in same-times mode", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Bike rental")
    await chooseType(dialog, "Day")
    await net.fail("services", {
      method: "POST",
      status: 422,
      body: {
        message: "The given data was invalid.",
        errors: {
          "start_time.monday": ["The start time.monday must match the format H:i:s."],
          surprise: ["Something else is wrong."],
        },
      },
    })
    await submit(dialog).click()
    await expect(fieldError(dialog, "Start time")).toHaveText("The start time.monday must match the format H:i:s.")
    // Keys the form doesn't know end up in the dialog's alert.
    const alert = dialog.getByRole("alert").filter({ hasText: "Hapio rejected the request" })
    await expect(alert).toContainText("Something else is wrong.")
    await expect(alert).not.toContainText("start time.monday")
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
    await expect(dialog).toBeVisible()
  })

  test("a 422 on start_time.monday shows on the Monday row in per-weekday mode", async ({ page, net }) => {
    const dialog = await openCreate(page)
    await nameInput(dialog).fill("Bike rental")
    await chooseType(dialog, "Day")
    await dialog.getByRole("radio", { name: "Per weekday" }).click()
    await net.fail("services", {
      method: "POST",
      status: 422,
      body: {
        message: "The given data was invalid.",
        errors: {
          "start_time.monday": ["Bad Monday start."],
          end_time: ["The end time field is required."],
        },
      },
    })
    await submit(dialog).click()
    await expect(dialog.getByRole("alert").filter({ hasText: "Start: Bad Monday start." })).toBeVisible()
    await expect(dialog.getByRole("alert").filter({ hasText: "End times: The end time field is required." })).toBeVisible()
    await expect(dialog.getByRole("alert").filter({ hasText: "Hapio rejected the request" })).toHaveCount(0)
  })
})

test.describe("service form: edit", () => {
  test("sends only the changed fields", async ({ page, api, net }) => {
    const { dialog, service } = await openEdit(page, api, SEED.services.haircut.name)
    await dialog.getByRole("textbox", { name: "Price per booking" }).fill("500")
    await setDuration(dialog, "Buffer after", { Minutes: 10 })
    const patch = net.waitFor("PATCH", `services/${service.id}`)
    await submit(dialog).click()
    expect((await patch).body).toEqual({ price: "500.000", buffer_time_after: "PT10M" })
    await expectToast(page, "Service updated", { type: "success" })
    await expect(dialog).toBeHidden()
    await expect(detailValue(card(page, "Pricing & rules"), "Price per booking")).toHaveText("500.00")
    await expect(detailValue(card(page, "Pricing & rules"), "Buffer after")).toHaveText("10 min")
  })

  test("changing a day service's max days sends just that", async ({ page, api, net }) => {
    const { dialog, service } = await openEdit(page, api, SEED.services.equipment.name)
    await expect(dialog.getByRole("spinbutton", { name: "Maximum days" })).toHaveValue("7")
    await dialog.getByRole("spinbutton", { name: "Maximum days" }).fill("5")
    const patch = net.waitFor("PATCH", `services/${service.id}`)
    await submit(dialog).click()
    expect((await patch).body).toEqual({ max_days: 5 })
    await expect(detailValue(card(page, "Booking length"), "Maximum days")).toHaveText("5 days")
  })

  test("switching an existing day service to per-weekday sends both times", async ({ page, api, net }) => {
    const { dialog, service } = await openEdit(page, api, SEED.services.equipment.name)
    await dialog.getByRole("radio", { name: "Per weekday" }).click()
    await dialog.getByLabel("Saturday start time").fill("10:00")
    const patch = net.waitFor("PATCH", `services/${service.id}`)
    await submit(dialog).click()
    const body = (await patch).body as Record<string, Record<string, string>>
    expect(Object.keys(body).sort()).toEqual(["end_time", "start_time"])
    expect(Object.keys(body.start_time)).toEqual(WEEKDAYS)
    expect(body.start_time.saturday).toBe("10:00:00")
    expect(body.end_time).toEqual(Object.fromEntries(WEEKDAYS.map((d) => [d, "17:00:00"])))
    await expect(card(page, "Booking length").getByRole("table")).toBeVisible()
  })

  test("changing the type warns and sends the new type with all its fields", async ({ page, api, net }) => {
    const { dialog, service } = await openEdit(page, api, SEED.services.haircut.name)
    await chooseType(dialog, "Day")
    await expect(dialog.getByRole("alert").filter({ hasText: "Changing the type" })).toHaveText(
      "Changing the type from Fixed to Day sends every day setting below along with the new type. Settings that only apply to fixed services are dropped."
    )
    const patch = net.waitFor("PATCH", `services/${service.id}`)
    await submit(dialog).click()
    expect((await patch).body).toEqual({
      type: "day",
      start_time: "09:00:00",
      end_time: "17:00:00",
      min_days: 1,
      max_days: null,
      default_days: null,
    })
    await expectToast(page, "Service updated")
    expect((await api.get<{ type: string }>(`services/${service.id}`)).type).toBe("day")
    await expect(page.getByRole("main").getByText("Day", { exact: true }).filter({ visible: true }).first()).toBeVisible()
    await expect(detailValue(card(page, "Booking length"), "Minimum days")).toHaveText("1 day")
  })

  test("changing a flexible service to fixed sends the fixed fields", async ({ page, api, net }) => {
    const { dialog, service } = await openEdit(page, api, SEED.services.studio.name)
    await chooseType(dialog, "Fixed")
    await expect(dialog.getByRole("alert").filter({ hasText: "Changing the type" })).toContainText(
      "from Flexible to Fixed sends every fixed setting"
    )
    await setDuration(dialog, "Duration", { Hours: 2 })
    const patch = net.waitFor("PATCH", `services/${service.id}`)
    await submit(dialog).click()
    expect((await patch).body).toEqual({ type: "fixed", duration: "PT2H", bookable_interval: null })
    await expect(detailValue(card(page, "Booking length"), "Duration")).toHaveText("2 h")
  })

  test("the type warning goes away when the type is changed back", async ({ page, api }) => {
    const { dialog } = await openEdit(page, api, SEED.services.haircut.name)
    await chooseType(dialog, "Flexible")
    await expect(dialog.getByRole("alert").filter({ hasText: "Changing the type" })).toBeVisible()
    await chooseType(dialog, "Fixed")
    await expect(dialog.getByRole("alert").filter({ hasText: "Changing the type" })).toHaveCount(0)
  })

  test("Cancel restores the saved values", async ({ page, api }) => {
    const { dialog } = await openEdit(page, api, SEED.services.haircut.name)
    await nameInput(dialog).fill("Something else")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole("button", { name: "Edit", exact: true }).click()
    await expect(nameInput(page.getByRole("dialog", { name: "Edit service" }))).toHaveValue(SEED.services.haircut.name)
  })

  test("a server error keeps the dialog open with the values", async ({ page, api, net }) => {
    const { dialog, service } = await openEdit(page, api, SEED.services.haircut.name)
    await nameInput(dialog).fill("Haircut deluxe")
    await net.fail(`services/${service.id}`, {
      method: "PATCH",
      status: 422,
      body: { message: "The given data was invalid.", errors: { name: ["The name has already been taken."] } },
    })
    await submit(dialog).click()
    await expect(fieldError(dialog, "Name")).toHaveText("The name has already been taken.")
    await expect(nameInput(dialog)).toHaveValue("Haircut deluxe")
  })

  test("saving without changes sends nothing", async ({ page, api, net }) => {
    const { dialog, service } = await openEdit(page, api, SEED.services.haircut.name)
    await submit(dialog).click()
    const toast = page.locator("[data-sonner-toast]")
    await expect(toast).toHaveCount(1)
    await expect(toast).toContainText("No changes to save")
    await expect(toast).toHaveAttribute("data-type", "info")
    await expect(dialog).toBeHidden()
    expect(net.find("PATCH", `services/${service.id}`)).toHaveLength(0)
  })

  test("a change typed back to the saved value counts as no change", async ({ page, api, net }) => {
    const { dialog, service } = await openEdit(page, api, SEED.services.haircut.name)
    await nameInput(dialog).fill("Haircut deluxe")
    await nameInput(dialog).fill(SEED.services.haircut.name)
    await submit(dialog).click()
    await expectToast(page, "No changes to save", { type: "info" })
    expect(net.find("PATCH", `services/${service.id}`)).toHaveLength(0)
  })

  test("after saving, the dialog reopens with the saved values and nothing to save", async ({ page, api, net }) => {
    const { dialog, service } = await openEdit(page, api, SEED.services.haircut.name)
    await dialog.getByRole("textbox", { name: "Price per booking" }).fill("500")
    const patch = net.waitFor("PATCH", `services/${service.id}`)
    await submit(dialog).click()
    expect((await patch).body).toEqual({ price: "500.000" })
    await expectToast(page, "Service updated")
    await expect(dialog).toBeHidden()

    await page.getByRole("button", { name: "Edit", exact: true }).click()
    await expect(dialog.getByRole("textbox", { name: "Price per booking" })).toHaveValue("500.000")
    await submit(dialog).click()
    await expectToast(page, "No changes to save", { type: "info" })
    expect(net.find("PATCH", `services/${service.id}`)).toHaveLength(1)
  })

  test("a background refetch keeps what is being typed", async ({ page, api, net }) => {
    const { dialog, service } = await openEdit(page, api, SEED.services.haircut.name)
    await nameInput(dialog).fill("Haircut deluxe")
    // Someone else changes the service, then the query refetches when the browser comes back online.
    await api.patch(`services/${service.id}`, { price: "999.000" })
    await page.clock.fastForward(31_000)
    const refetch = net.waitFor("GET", `services/${service.id}`)
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"))
      window.dispatchEvent(new Event("online"))
    })
    await refetch
    // The page behind the dialog shows the new price, so the refetched service has rendered.
    await expect(detailValue(card(page, "Pricing & rules"), "Price per booking")).toHaveText("999.00")
    await expect(nameInput(dialog)).toHaveValue("Haircut deluxe")
    // Untouched fields follow the server, and only the typed change is sent.
    await expect(dialog.getByRole("textbox", { name: "Price per booking" })).toHaveValue("999.000")
    const patch = net.waitFor("PATCH", `services/${service.id}`)
    await submit(dialog).click()
    expect((await patch).body).toEqual({ name: "Haircut deluxe" })
    await expect(page.getByRole("heading", { level: 1, name: "Haircut deluxe" })).toBeVisible()
  })

  test("a day service ending at 24:00 can still be edited", async ({ page, api, net }) => {
    const id = await api.idOf("services", SEED.services.equipment.name)
    await api.patch(`services/${id}`, { end_time: "24:00:00" })
    const { dialog } = await openEdit(page, api, SEED.services.equipment.name)
    await expect(field(dialog, "End time").getByRole("checkbox", { name: "End of day (24:00)" })).toBeChecked()
    await dialog.getByRole("spinbutton", { name: "Maximum days" }).fill("5")
    const patch = net.waitFor("PATCH", `services/${id}`)
    await submit(dialog).click()
    expect((await patch).body).toEqual({ max_days: 5 })
    await expect(fieldError(dialog, "End time")).toHaveCount(0)
    await expect(dialog).toBeHidden()
  })

  test("a day service's 24:00 end can be changed back to a time", async ({ page, api, net }) => {
    const id = await api.idOf("services", SEED.services.equipment.name)
    await api.patch(`services/${id}`, { end_time: "24:00:00" })
    const { dialog } = await openEdit(page, api, SEED.services.equipment.name)
    await field(dialog, "End time").getByRole("checkbox", { name: "End of day (24:00)" }).click()
    const endTime = dialog.getByLabel("End time", { exact: true })
    await expect(endTime).toBeEnabled()
    await endTime.fill("18:00")
    const patch = net.waitFor("PATCH", `services/${id}`)
    await submit(dialog).click()
    expect((await patch).body).toEqual({ end_time: "18:00:00" })
    await expect(detailValue(card(page, "Booking length"), "End time")).toHaveText("18:00")
  })
})
