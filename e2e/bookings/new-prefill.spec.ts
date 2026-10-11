import { expectToast } from "../helpers/toasts"
import { bookingForm, expect, field, test } from "./_helpers"

const PREFILLED = "Prefilled from your selection. Review the details and create the booking."
const PLAIN = "Book a service at a location. Hapio checks availability unless you override its rules."

test.describe("/bookings/new prefill", () => {
  test("fills every field of the prefill contract from encoded params", async ({ page, api, net }) => {
    const [service, location, resource] = await Promise.all([
      api.idOf("services", "Haircut"),
      api.idOf("locations", "Stockholm Studio"),
      api.idOf("resources", "Ben"),
    ])
    const params = new URLSearchParams({
      service,
      location,
      resource,
      starts_at: "2026-10-22T11:00:00+02:00",
      ends_at: "2026-10-22T11:45:00+02:00",
    })
    await page.goto(`/bookings/new?${params}`)
    const form = bookingForm(page)
    // API-derived labels prove the pickers loaded.
    await expect(form.service).toHaveText("Haircut")
    await expect(form.location).toHaveText("Stockholm Studio")
    await expect(form.resource).toHaveText("Ben")
    await expect(page.getByText(PREFILLED)).toBeVisible()
    await expect(form.starts).toHaveValue("2026-10-22T11:00")
    await expect(form.ends).toHaveValue("2026-10-22T11:45")
    await expect(page.getByText("Length: 45 min. Changing the start keeps the length.")).toBeVisible()

    const request = net.waitFor("POST", "bookings")
    await page.getByRole("button", { name: "Create booking" }).click()
    expect((await request).body).toEqual({
      service_id: service,
      location_id: location,
      resource_id: resource,
      starts_at: "2026-10-22T11:00:00+02:00",
      ends_at: "2026-10-22T11:45:00+02:00",
    })
    await expectToast(page, "Booking created")
  })

  test("a New York slot keeps its New York wall time", async ({ page, api }) => {
    const [service, location] = await Promise.all([api.idOf("services", "Haircut"), api.idOf("locations", "New York Loft")])
    const params = new URLSearchParams({
      service,
      location,
      starts_at: "2026-10-22T10:00:00-04:00",
      ends_at: "2026-10-22T10:45:00-04:00",
    })
    await page.goto(`/bookings/new?${params}`)
    const form = bookingForm(page)
    await expect(form.location).toHaveText("New York Loft")
    await expect(field(page, "Location")).toContainText("Times are in America/New_York.")
    await expect(form.starts).toHaveValue("2026-10-22T10:00")
    await expect(form.ends).toHaveValue("2026-10-22T10:45")
  })

  test("an unencoded + in the offset (arriving as a space) is restored", async ({ page, api, net }) => {
    const [service, location] = await Promise.all([api.idOf("services", "Haircut"), api.idOf("locations", "Stockholm Studio")])
    await page.goto(
      `/bookings/new?service=${service}&location=${location}&starts_at=2026-10-22T11:00:00+02:00&ends_at=2026-10-22T11:45:00+02:00`
    )
    const form = bookingForm(page)
    await expect(form.location).toHaveText("Stockholm Studio")
    await expect(form.starts).toHaveValue("2026-10-22T11:00")
    await expect(form.ends).toHaveValue("2026-10-22T11:45")
    const request = net.waitFor("POST", "bookings")
    await page.getByRole("button", { name: "Create booking" }).click()
    expect((await request).body).toMatchObject({
      starts_at: "2026-10-22T11:00:00+02:00",
      ends_at: "2026-10-22T11:45:00+02:00",
    })
  })

  test("is_temporary=true turns on Temporary", async ({ page, api }) => {
    const service = await api.idOf("services", "Haircut")
    await page.goto(`/bookings/new?service=${service}&is_temporary=true`)
    const form = bookingForm(page)
    await expect(form.service).toHaveText("Haircut")
    await expect(page.getByText(PREFILLED)).toBeVisible()
    await expect(form.temporary).toBeChecked()
  })

  test("other is_temporary values are ignored", async ({ page, api }) => {
    const service = await api.idOf("services", "Haircut")
    await page.goto(`/bookings/new?service=${service}&is_temporary=1`)
    const form = bookingForm(page)
    await expect(form.service).toHaveText("Haircut")
    await expect(form.temporary).not.toBeChecked()
  })

  test("booking_group fills the group", async ({ page, api, net }) => {
    const [group] = await api.list<{ id: string }>("booking-groups")
    const [service, location] = await Promise.all([api.idOf("services", "Haircut"), api.idOf("locations", "Stockholm Studio")])
    await page.goto(`/bookings/new?service=${service}&location=${location}&booking_group=${group.id}`)
    const form = bookingForm(page)
    await expect(form.location).toHaveText("Stockholm Studio")
    await expect(form.group).toHaveValue(group.id)
    await form.starts.fill("2026-10-22T11:00")
    const request = net.waitFor("POST", "bookings")
    await page.getByRole("button", { name: "Create booking" }).click()
    expect((await request).body).toMatchObject({ booking_group_id: group.id })
  })

  test("unknown params don't count as a prefill", async ({ page, ui }) => {
    await page.goto("/bookings/new?utm_source=newsletter")
    await expect(ui.heading("New booking")).toBeVisible()
    const form = bookingForm(page)
    await form.service.click()
    await expect(page.getByRole("option", { name: /^Haircut/ })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByText(PLAIN)).toBeVisible()
    await expect(form.service).toHaveText("Select service…")
  })

  test("changing the search params remounts the form with the new defaults", async ({ page, api }) => {
    const [haircut, studio] = await Promise.all([api.idOf("services", "Haircut"), api.idOf("services", "Studio rental")])
    await page.goto(`/bookings/new?service=${haircut}`)
    const form = bookingForm(page)
    await expect(form.service).toHaveText("Haircut")
    await form.metadata.fill('{ "draft": true }')

    // Client-side navigation (Next.js syncs history.pushState with useSearchParams).
    await page.evaluate((url) => window.history.pushState(null, "", url), `/bookings/new?service=${studio}`)
    await expect(form.service).toHaveText("Studio rental")
    await expect(form.metadata).toHaveValue("")

    await page.evaluate(() => window.history.pushState(null, "", "/bookings/new"))
    await expect(page.getByText(PLAIN)).toBeVisible()
    await expect(form.service).toHaveText("Select service…")
  })

  test("a start without an end gets the service's length", async ({ page, api }) => {
    const [service, location] = await Promise.all([api.idOf("services", "Haircut"), api.idOf("locations", "Stockholm Studio")])
    const params = new URLSearchParams({ service, location, starts_at: "2026-10-22T11:00:00+02:00" })
    await page.goto(`/bookings/new?${params}`)
    const form = bookingForm(page)
    await expect(form.service).toHaveText("Haircut")
    await expect(form.starts).toHaveValue("2026-10-22T11:00")
    await expect(form.ends).toHaveValue("2026-10-22T11:45")
  })

  test("a New York start without an end gets the service's length in New York time", async ({ page, api, net }) => {
    const [service, location] = await Promise.all([api.idOf("services", "Haircut"), api.idOf("locations", "New York Loft")])
    const params = new URLSearchParams({ service, location, starts_at: "2026-10-22T10:00:00-04:00" })
    await page.goto(`/bookings/new?${params}`)
    const form = bookingForm(page)
    await expect(form.location).toHaveText("New York Loft")
    await expect(form.ends).toHaveValue("2026-10-22T10:45")
    const request = net.waitFor("POST", "bookings")
    await page.getByRole("button", { name: "Create booking" }).click()
    expect((await request).body).toMatchObject({
      starts_at: "2026-10-22T10:00:00-04:00",
      ends_at: "2026-10-22T10:45:00-04:00",
    })
  })

  test("a prefilled end is kept", async ({ page, api }) => {
    const [service, location] = await Promise.all([api.idOf("services", "Haircut"), api.idOf("locations", "Stockholm Studio")])
    const params = new URLSearchParams({
      service,
      location,
      starts_at: "2026-10-22T11:00:00+02:00",
      ends_at: "2026-10-22T13:00:00+02:00",
    })
    await page.goto(`/bookings/new?${params}`)
    const form = bookingForm(page)
    await expect(form.service).toHaveText("Haircut")
    await expect(page.getByText("Length: 2 h. Changing the start keeps the length.")).toBeVisible()
    await expect(form.ends).toHaveValue("2026-10-22T13:00")
  })
})
