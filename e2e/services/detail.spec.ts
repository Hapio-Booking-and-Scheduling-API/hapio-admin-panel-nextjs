import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { recordAppearances } from "../helpers/flash"
import { expectToast } from "../helpers/toasts"
import { card, detailValue, gotoService } from "./_helpers"

const { haircut, studio, equipment } = SEED.services

test.describe("service detail: overview", () => {
  test("fixed service", async ({ page, api }) => {
    await gotoService(page, api, haircut.name)
    // Badges sit next to the h1.
    const badges = page.getByRole("heading", { level: 1, name: haircut.name }).locator("xpath=..")
    await expect(badges.locator('[data-slot="badge"]')).toHaveText(["Fixed", "Enabled"])
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")

    const length = card(page, "Booking length")
    await expect(length).toContainText("Appointments with a fixed length, like a 45-minute haircut.")
    await expect(detailValue(length, "Duration")).toHaveText("45 min")
    await expect(detailValue(length, "Bookable interval")).toHaveText("DefaultDuration + buffers")

    const rules = card(page, "Pricing & rules")
    await expect(detailValue(rules, "Price per booking")).toHaveText("450.00")
    await expect(detailValue(rules, "Buffer before")).toHaveText("None")
    await expect(detailValue(rules, "Buffer after")).toHaveText("15 min")
    await expect(detailValue(rules, "Minimum notice")).toHaveText("NoneBookable right up to the start")
    await expect(detailValue(rules, "Booking horizon")).toHaveText("No limit")
    await expect(detailValue(rules, "Cancelation threshold")).toHaveText("NoneCancelable right up to the start")
    await expect(detailValue(rules, "Created")).toHaveText("30 Sep 2026, 06:07 (UTC)")

    await expect(card(page, "Metadata").locator("pre")).toHaveText(JSON.stringify({ category: "hair" }, null, 2))
    await expect(card(page, "Protected metadata").locator("pre")).toHaveText("null")
  })

  test("fixed service with rules set", async ({ page, api }) => {
    const id = await api.idOf("services", haircut.name)
    await api.patch(`services/${id}`, {
      bookable_interval: "PT30M",
      booking_window_start: "PT2H",
      booking_window_end: "P1D",
      cancelation_threshold: "P1D",
      buffer_time_before: "PT5M",
      price: null,
    })
    await gotoService(page, api, haircut.name)
    await expect(detailValue(card(page, "Booking length"), "Bookable interval")).toHaveText("Every 30 min")
    const rules = card(page, "Pricing & rules")
    await expect(detailValue(rules, "Price per booking")).toHaveText("No price")
    await expect(detailValue(rules, "Buffer before")).toHaveText("5 min")
    await expect(detailValue(rules, "Minimum notice")).toHaveText("2 h before the start")
    await expect(detailValue(rules, "Booking horizon")).toHaveText("Until the end of today")
    await expect(detailValue(rules, "Cancelation threshold")).toHaveText("Up to 1 day before the start")
  })

  test("booking horizon wording", async ({ page, api }) => {
    const id = await api.idOf("services", haircut.name)
    const horizon = () => detailValue(card(page, "Pricing & rules"), "Booking horizon")

    await api.patch(`services/${id}`, { booking_window_end: "P30D" })
    await gotoService(page, api, haircut.name)
    await expect(horizon()).toHaveText("30 daysCounted in whole days from the start of today")

    await api.patch(`services/${id}`, { booking_window_end: "PT12H" })
    await page.reload()
    await expect(horizon()).toHaveText("Up to 12 h ahead")

    await api.patch(`services/${id}`, { booking_window_end: "P2W" })
    await page.reload()
    await expect(horizon()).toHaveText("2 weeksCounted in whole days from the start of today")
  })

  test("flexible service", async ({ page, api }) => {
    await gotoService(page, api, studio.name)
    const length = card(page, "Booking length")
    await expect(length).toContainText("The customer picks a length in steps")
    await expect(detailValue(length, "Minimum length")).toHaveText("1 h")
    await expect(detailValue(length, "Maximum length")).toHaveText("4 h")
    await expect(detailValue(length, "Step")).toHaveText("30 min")
    await expect(detailValue(length, "Default length")).toHaveText("None")
    await expect(detailValue(length, "Bookable interval")).toHaveText("Same as stepEvery 30 min")
    await expect(detailValue(card(page, "Pricing & rules"), "Hourly rate")).toHaveText("300.00 per hour")
  })

  test("flexible service without a maximum, with a default and interval", async ({ page, api }) => {
    const id = await api.idOf("services", studio.name)
    await api.patch(`services/${id}`, { max_duration: null, default_duration: "PT2H", bookable_interval: "PT1H" })
    await gotoService(page, api, studio.name)
    const length = card(page, "Booking length")
    await expect(detailValue(length, "Maximum length")).toHaveText("No maximum")
    await expect(detailValue(length, "Default length")).toHaveText("2 h")
    await expect(detailValue(length, "Bookable interval")).toHaveText("Every 1 h")
  })

  test("day service with the same times every day", async ({ page, api }) => {
    await gotoService(page, api, equipment.name)
    const length = card(page, "Booking length")
    await expect(length).toContainText("Bookings spanning whole days, like rentals or stays.")
    await expect(detailValue(length, "Minimum days")).toHaveText("1 day")
    await expect(detailValue(length, "Maximum days")).toHaveText("7 days")
    await expect(detailValue(length, "Default days")).toHaveText("None")
    await expect(detailValue(length, "Start time")).toHaveText("09:00")
    await expect(detailValue(length, "End time")).toHaveText("17:00")
    await expect(length.getByRole("table")).toHaveCount(0)
    await expect(detailValue(card(page, "Pricing & rules"), "Daily rate")).toHaveText("150.00 per day")
  })

  test("day service with per-weekday times shows a table", async ({ page, api }) => {
    const id = await api.idOf("services", equipment.name)
    await api.patch(`services/${id}`, {
      start_time: {
        monday: "09:00:00",
        tuesday: "09:00:00",
        wednesday: "09:00:00",
        thursday: "09:00:00",
        friday: "08:00:00",
        saturday: "10:00:00",
        sunday: "10:30:00",
      },
      end_time: "17:00:00",
      max_days: null,
      default_days: 2,
    })
    await gotoService(page, api, equipment.name)
    const length = card(page, "Booking length")
    await expect(detailValue(length, "Maximum days")).toHaveText("No limit")
    await expect(detailValue(length, "Default days")).toHaveText("2 days")
    await expect(detailValue(length, "Start time")).toHaveCount(0)
    const table = detailValue(length, "Start & end times").getByRole("table")
    await expect(table.getByRole("row")).toHaveText([
      "DayStartEnd",
      "Monday09:0017:00",
      "Tuesday09:0017:00",
      "Wednesday09:0017:00",
      "Thursday09:0017:00",
      "Friday08:0017:00",
      "Saturday10:0017:00",
      "Sunday10:3017:00",
    ])
  })

  test("unknown service shows a 404 error", async ({ page }) => {
    await page.goto("/services/00000000-0000-4000-8000-000000000000")
    await expect(page.getByRole("alert").filter({ hasText: "Request failed (404)" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible()
  })
})

test.describe("service detail: tabs and actions", () => {
  test("Resources tab shows the number of associated resources", async ({ page, api }) => {
    await gotoService(page, api, haircut.name)
    await expect(page.getByRole("tab", { name: /^Resources/ })).toHaveText(/^Resources\s*3$/)
    await gotoService(page, api, equipment.name)
    await expect(page.getByRole("tab", { name: /^Resources/ })).toHaveText(/^Resources\s*1$/)
  })

  test("tabs are kept in the URL", async ({ page, api, ui }) => {
    const service = await gotoService(page, api, haircut.name)
    await ui.tab("Bookable slots")
    await expect(page).toHaveURL(`/services/${service.id}?tab=slots`)
    await expect(page.getByText("Find bookable slots")).toBeVisible()
    await ui.tab("JSON")
    await expect(page).toHaveURL(`/services/${service.id}?tab=json`)
    await ui.tab(/^Resources/)
    await expect(page).toHaveURL(`/services/${service.id}?tab=resources`)
    await ui.tab("Overview")
    await expect(page).toHaveURL(`/services/${service.id}`)
  })

  test("?tab=slots opens the bookable slots tab", async ({ page, api }) => {
    await gotoService(page, api, studio.name, "slots")
    await expect(page.getByRole("tab", { name: "Bookable slots" })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByText("Search for slots")).toBeVisible()
    await expect(page.getByText("Length to fit")).toBeVisible()
  })

  test("Bookings links to the service's bookings", async ({ page, api }) => {
    const service = await gotoService(page, api, haircut.name)
    await page.getByRole("main").getByRole("link", { name: "Bookings" }).click()
    await expect(page).toHaveURL(new RegExp(`/bookings\\?service=${service.id}$`))
  })

  test("Disable and Enable", async ({ page, api, net }) => {
    const service = await gotoService(page, api, haircut.name)
    let patch = net.waitFor("PATCH", `services/${service.id}`)
    await page.getByRole("button", { name: "Disable" }).click()
    expect((await patch).body).toEqual({ enabled: false })
    await expectToast(page, "Service disabled", { type: "success" })
    await expect(page.getByRole("main").getByText("Disabled", { exact: true })).toBeVisible()

    patch = net.waitFor("PATCH", `services/${service.id}`)
    await page.getByRole("button", { name: "Enable" }).click()
    expect((await patch).body).toEqual({ enabled: true })
    await expectToast(page, "Service enabled", { type: "success" })
    await expect(page.getByRole("main").getByText("Enabled", { exact: true })).toBeVisible()
    expect((await api.get<{ enabled: boolean }>(`services/${service.id}`)).enabled).toBe(true)
  })

  test("Delete asks first and goes back to the list", async ({ page, api, net, ui }) => {
    const service = await gotoService(page, api, haircut.name)
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await expect(ui.alertDialog(`Delete ${haircut.name}?`)).toContainText("Consider disabling it instead.")
    await ui.dismiss(`Delete ${haircut.name}?`)

    await page.getByRole("button", { name: "Delete", exact: true }).click()
    const request = net.waitFor("DELETE", `services/${service.id}`)
    await ui.confirm(`Delete ${haircut.name}?`, "Delete service")
    await request
    await expectToast(page, "Service deleted", { type: "success" })
    await expect(page).toHaveURL(/\/services$/)
    await expect(page.getByRole("main").getByRole("table").getByRole("row")).toHaveCount(3)
    await expect(ui.row(haircut.name)).toHaveCount(0)
  })

  // BUG-02: the refresh after a delete used to refetch the deleted service (GET → 404), which
  // flashed "Request failed (404)" on other detail pages. The first test guards the visible
  // symptom, the second the refetch itself.
  test("deleting doesn't flash a 404 error", async ({ page, api, ui }) => {
    await gotoService(page, api, haircut.name)
    const appeared = await recordAppearances(page, '[role="alert"]', "Request failed (404)")
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await ui.confirm(`Delete ${haircut.name}?`, "Delete service")
    await expect(page).toHaveURL(/\/services$/)
    await expect(page.getByRole("main").getByRole("table").getByText(studio.name)).toBeVisible()
    expect(await appeared()).toBe(false)
  })

  test("deleting doesn't refetch the deleted service", async ({ page, api, ui, net }) => {
    const service = await gotoService(page, api, haircut.name)
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await ui.confirm(`Delete ${haircut.name}?`, "Delete service")
    await expect(page).toHaveURL(/\/services$/)
    await expect(page.getByRole("main").getByRole("table").getByText(studio.name)).toBeVisible()
    const deletedAt = net.calls.findIndex((c) => c.method === "DELETE" && c.path === `services/${service.id}`)
    expect(deletedAt).toBeGreaterThan(-1)
    // Neither the service nor its resources are fetched again.
    const refetches = net.calls
      .slice(deletedAt + 1)
      .filter((c) => c.method === "GET" && c.path.startsWith(`services/${service.id}`))
    expect(refetches).toHaveLength(0)
  })

  test("JSON tab shows the raw service and replaces it with PUT", async ({ page, api, net, ui }) => {
    const service = await gotoService(page, api, studio.name, "json")
    await expect(page.getByRole("main").locator("pre")).toContainText(`"id": "${service.id}"`)
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const textarea = dialog.getByRole("textbox", { name: "JSON body" })
    const body = JSON.parse(await textarea.inputValue()) as Record<string, unknown>
    expect(body).not.toHaveProperty("id")
    expect(body).not.toHaveProperty("created_at")
    expect(body).not.toHaveProperty("updated_at")
    expect(body).toMatchObject({ name: studio.name, type: "flexible", min_duration: "PT1H", max_duration: "PT4H" })

    await textarea.fill("{ not json")
    await dialog.getByRole("button", { name: "Replace" }).click()
    await expect(dialog.getByText(/JSON/).last()).toBeVisible()
    await expect(textarea).toHaveAttribute("aria-invalid", "true")
    expect(net.find("PUT", `services/${service.id}`)).toHaveLength(0)

    await textarea.fill(JSON.stringify({ ...body, name: "Studio rental (PUT)", max_duration: "PT3H" }, null, 2))
    const put = net.waitFor("PUT", `services/${service.id}`)
    await dialog.getByRole("button", { name: "Replace" }).click()
    expect((await put).body).toMatchObject({ name: "Studio rental (PUT)", max_duration: "PT3H" })
    await expectToast(page, "Service replaced", { type: "success" })
    await expect(dialog).toBeHidden()
    await expect(ui.heading("Studio rental (PUT)")).toBeVisible()
    expect(await api.get(`services/${service.id}`)).toMatchObject({ name: "Studio rental (PUT)", max_duration: "PT3H" })
  })

  test("JSON replace shows validation errors in the dialog", async ({ page, api, ui }) => {
    await gotoService(page, api, haircut.name, "json")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    await dialog.getByRole("textbox", { name: "JSON body" }).fill(JSON.stringify({ name: "No type" }))
    await dialog.getByRole("button", { name: "Replace" }).click()
    await expect(dialog.getByRole("alert").filter({ hasText: "Request failed (422)" })).toContainText("type")
    // Reported once, inside the dialog. The toast, if any, is raised before the dialog shows the error.
    expect(await page.locator("[data-sonner-toast]").count()).toBe(0)
    await expect(dialog).toBeVisible()
  })
})
