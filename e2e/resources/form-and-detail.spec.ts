import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { recordAppearances } from "../helpers/flash"
import { expectNoToast, expectToast } from "../helpers/toasts"
import { createResource, detailValue, fieldError, gotoResource, refetchOnReconnect, wallDateTime } from "./_helpers"

const { anna, ben, roomA } = SEED.resources

test.describe("create a resource", () => {
  test("validates the form, then creates and opens the resource", async ({ page, ui, net }) => {
    await page.goto("/resources")
    await expect(ui.main().getByRole("cell", { name: anna.name, exact: true })).toBeVisible()
    await ui.main().getByRole("button", { name: "New resource" }).click()

    const dialog = ui.dialog("New resource")
    const unlimited = dialog.getByRole("switch", { name: "Unlimited" })
    const max = dialog.getByRole("spinbutton", { name: "Max simultaneous bookings" })
    await expect(unlimited).toBeChecked()
    await expect(max).toBeDisabled()
    await expect(max).toHaveAttribute("placeholder", "Unlimited")
    await expect(dialog.getByRole("switch", { name: "Enabled" })).toBeChecked()

    await dialog.getByRole("button", { name: "Create resource" }).click()
    await expect(fieldError(dialog, "Name")).toHaveText("Required")

    await unlimited.click()
    await expect(max).toBeEnabled()
    await expect(max).toHaveValue("1")
    await max.fill("")
    await dialog.getByRole("button", { name: "Create resource" }).click()
    await expect(fieldError(dialog, "Max simultaneous bookings")).toHaveText("Enter a whole number")
    await max.fill("0")
    await expect(fieldError(dialog, "Max simultaneous bookings")).toHaveText("Must be at least 1")
    await max.fill("1.5")
    await expect(fieldError(dialog, "Max simultaneous bookings")).toHaveText("Enter a whole number")
    expect(net.find("POST", "resources")).toHaveLength(0)

    await max.fill("3")
    await dialog.getByRole("textbox", { name: "Name" }).fill("Studio C")
    await dialog.getByRole("textbox", { name: "Metadata", exact: true }).fill('{"role": "room"}')
    await expect(dialog.getByText("Valid JSON object")).toBeVisible()
    const post = net.waitFor("POST", "resources")
    await dialog.getByRole("button", { name: "Create resource" }).click()
    expect((await post).body).toEqual({
      name: "Studio C",
      max_simultaneous_bookings: 3,
      enabled: true,
      metadata: { role: "room" },
    })
    await expectToast(page, "Resource created", { type: "success" })
    await expect(ui.heading("Studio C")).toBeVisible()
    await expect(page).toHaveURL(/\/resources\/[0-9a-f-]{36}$/)
    await expect(detailValue(ui.main(), "Max simultaneous bookings")).toContainText("Up to 3 overlapping bookings.")
  })

  test("sends unlimited capacity, disabled state and protected metadata", async ({ page, ui, net }) => {
    await page.goto("/resources")
    await expect(ui.main().getByRole("cell", { name: anna.name, exact: true })).toBeVisible()
    await ui.main().getByRole("button", { name: "New resource" }).click()
    const dialog = ui.dialog("New resource")
    await dialog.getByRole("textbox", { name: "Name" }).fill("Projector")
    await dialog.getByRole("switch", { name: "Enabled" }).click()
    await dialog.getByRole("textbox", { name: "Protected metadata" }).fill('{"serial": "X1"}')
    const post = net.waitFor("POST", "resources")
    await dialog.getByRole("button", { name: "Create resource" }).click()
    expect((await post).body).toEqual({
      name: "Projector",
      max_simultaneous_bookings: null,
      enabled: false,
      metadata: null,
      protected_metadata: { serial: "X1" },
    })
    await expect(ui.heading("Projector")).toBeVisible()
    // The list stays mounted (hidden) after client navigation, so only count visible badges.
    await expect(ui.main().getByText("Disabled", { exact: true }).filter({ visible: true })).toBeVisible()
    await expect(detailValue(ui.main(), "Max simultaneous bookings")).toHaveText("UnlimitedAny number of bookings can overlap.")
  })

  test("leaves out whitespace-only protected metadata", async ({ page, ui, net }) => {
    await page.goto("/resources")
    await expect(ui.main().getByRole("cell", { name: anna.name, exact: true })).toBeVisible()
    await ui.main().getByRole("button", { name: "New resource" }).click()
    const dialog = ui.dialog("New resource")
    await dialog.getByRole("textbox", { name: "Name" }).fill("Easel")
    await dialog.getByRole("textbox", { name: "Protected metadata" }).fill("   \n  ")
    const post = net.waitFor("POST", "resources")
    await dialog.getByRole("button", { name: "Create resource" }).click()
    const body = (await post).body as Record<string, unknown>
    expect(body).not.toHaveProperty("protected_metadata")
    expect(body).toMatchObject({ name: "Easel", metadata: null })
    await expect(ui.heading("Easel")).toBeVisible()
  })

  test("the new resource dialog starts empty again after creating", async ({ page, ui }) => {
    await page.goto("/resources")
    await expect(ui.main().getByRole("cell", { name: anna.name, exact: true })).toBeVisible()
    await ui.main().getByRole("button", { name: "New resource" }).click()
    const dialog = ui.dialog("New resource")
    await dialog.getByRole("textbox", { name: "Name" }).fill("Studio D")
    await dialog.getByRole("switch", { name: "Enabled" }).click()
    await dialog.getByRole("button", { name: "Create resource" }).click()
    await expectToast(page, "Resource created")
    await expect(ui.heading("Studio D")).toBeVisible()

    await page.goBack()
    await expect(ui.main().getByRole("cell", { name: "Studio D", exact: true })).toBeVisible()
    await ui.main().getByRole("button", { name: "New resource" }).click()
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("")
    await expect(dialog.getByRole("switch", { name: "Enabled" })).toBeChecked()
  })

  test("rejects invalid metadata before sending", async ({ page, ui, net }) => {
    await page.goto("/resources")
    await expect(ui.main().getByRole("cell", { name: anna.name, exact: true })).toBeVisible()
    await ui.main().getByRole("button", { name: "New resource" }).click()
    const dialog = ui.dialog("New resource")
    await dialog.getByRole("textbox", { name: "Name" }).fill("Broken")
    await dialog.getByRole("textbox", { name: "Metadata", exact: true }).fill("[1, 2]")
    await dialog.getByRole("button", { name: "Create resource" }).click()
    await expect(fieldError(dialog, "Metadata")).toHaveText("Metadata must be a JSON object.")
    expect(net.find("POST", "resources")).toHaveLength(0)
  })

  test("shows server validation errors on the field, and unknown ones in the form", async ({ page, ui, net }) => {
    await net.fail("resources", {
      method: "POST",
      status: 422,
      body: {
        message: "The given data was invalid.",
        errors: { name: ["The name has already been taken."], color: ["The color is not supported."] },
      },
    })
    await page.goto("/resources")
    await expect(ui.main().getByRole("cell", { name: anna.name, exact: true })).toBeVisible()
    await ui.main().getByRole("button", { name: "New resource" }).click()
    const dialog = ui.dialog("New resource")
    await dialog.getByRole("textbox", { name: "Name" }).fill(anna.name)
    await dialog.getByRole("button", { name: "Create resource" }).click()
    await expect(fieldError(dialog, "Name")).toHaveText("The name has already been taken.")
    await expect(dialog.getByRole("alert").filter({ hasText: "Hapio rejected the request" })).toContainText(
      "The color is not supported."
    )
    await expect(dialog).toBeVisible()
    await expectNoToast(page, "The given data was invalid.")
  })
})

test.describe("edit a resource", () => {
  test("sends only the changed fields", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, anna.name)
    await ui.main().getByRole("button", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit resource")
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(anna.name)
    await expect(dialog.getByRole("spinbutton", { name: "Max simultaneous bookings" })).toHaveValue("1")
    await expect(dialog.getByRole("switch", { name: "Unlimited" })).not.toBeChecked()
    await expect(dialog.getByRole("textbox", { name: "Metadata", exact: true })).toHaveValue(/"role": "stylist"/)

    await dialog.getByRole("textbox", { name: "Name" }).fill("Anna K")
    const patch = net.waitFor("PATCH", `resources/${resource.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toEqual({ name: "Anna K" })
    await expectToast(page, "Resource updated")
    await expect(dialog).toBeHidden()
    await expect(ui.heading("Anna K")).toBeVisible()
    expect((await api.get(`resources/${resource.id}`)).metadata).toEqual({ role: "stylist", level: 3 })
  })

  test("switches a resource to unlimited capacity", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, roomA.name)
    await expect(detailValue(ui.main(), "Max simultaneous bookings")).toHaveText("2Up to 2 overlapping bookings.")
    await ui.main().getByRole("button", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit resource")
    await dialog.getByRole("switch", { name: "Unlimited" }).click()
    const patch = net.waitFor("PATCH", `resources/${resource.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toEqual({ max_simultaneous_bookings: null })
    await expect(detailValue(ui.main(), "Max simultaneous bookings")).toHaveText("UnlimitedAny number of bookings can overlap.")
  })

  test("cancel discards the edits", async ({ page, api, ui }) => {
    await gotoResource(page, api, anna.name)
    await ui.main().getByRole("button", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit resource")
    await dialog.getByRole("textbox", { name: "Name" }).fill("Something else")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await ui.main().getByRole("button", { name: "Edit" }).click()
    await expect(ui.dialog("Edit resource").getByRole("textbox", { name: "Name" })).toHaveValue(anna.name)
  })

  test("saving without changes sends nothing", async ({ page, api, ui, net }) => {
    await gotoResource(page, api, anna.name)
    await ui.main().getByRole("button", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit resource")
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await expectToast(page, "No changes to save", { type: "info" })
    await expect(dialog).toBeHidden()
    expect(net.find("PATCH", /^resources\//)).toHaveLength(0)
  })

  test("a field changed and changed back counts as unchanged", async ({ page, api, ui, net }) => {
    await gotoResource(page, api, anna.name)
    await ui.main().getByRole("button", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit resource")
    await dialog.getByRole("textbox", { name: "Name" }).fill("Anna K")
    await dialog.getByRole("textbox", { name: "Name" }).fill(anna.name)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await expectToast(page, "No changes to save", { type: "info" })
    expect(net.find("PATCH", /^resources\//)).toHaveLength(0)
  })

  test("after saving, a second save without changes sends nothing", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, anna.name)
    await ui.main().getByRole("button", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit resource")
    await dialog.getByRole("textbox", { name: "Name" }).fill("Anna K")
    const patch = net.waitFor("PATCH", `resources/${resource.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await patch
    await expectToast(page, "Resource updated")
    await expect(ui.heading("Anna K")).toBeVisible()

    await ui.main().getByRole("button", { name: "Edit" }).click()
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Anna K")
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await expectToast(page, "No changes to save", { type: "info" })
    expect(net.find("PATCH", /^resources\//)).toHaveLength(1)
  })

  test("keeps typed edits when the resource refetches", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, anna.name)
    await ui.main().getByRole("button", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit resource")
    await dialog.getByRole("textbox", { name: "Name" }).fill("Anna typed")

    await api.patch(`resources/${resource.id}`, { metadata: { role: "senior" } })
    await refetchOnReconnect(page)
    // The overview behind the dialog shows the refetched metadata.
    await expect(page.locator("main pre").first()).toContainText('"senior"')

    // Untouched fields follow the server; the typed name stays.
    await expect(dialog.getByRole("textbox", { name: "Metadata", exact: true })).toHaveValue(/"role": "senior"/)
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Anna typed")
    const patch = net.waitFor("PATCH", `resources/${resource.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await patch).body).toEqual({ name: "Anna typed" })
  })
})

test.describe("resource detail", () => {
  test("overview shows capacity, timestamps and metadata", async ({ page, api, ui }) => {
    const resource = await gotoResource(page, api, anna.name)
    const main = ui.main()
    await expect(main.getByText("Enabled", { exact: true })).toBeVisible()
    await expect(main.getByText(resource.id)).toBeVisible()
    await expect(detailValue(main, "Max simultaneous bookings")).toHaveText("1One booking at a time.")
    await expect(detailValue(main, "Created")).toHaveText(`${wallDateTime(resource.created_at as string)} (UTC)`)
    await expect(detailValue(main, "Updated")).toHaveText(`${wallDateTime(resource.updated_at as string)} (UTC)`)
    const metadata = main.locator('[data-slot="card"]').filter({ has: page.getByText("Metadata", { exact: true }) })
    await expect(metadata.locator("pre")).toContainText('"role": "stylist"')
    await expect(metadata.locator("pre")).toContainText('"level": 3')
    const protectedCard = main.locator('[data-slot="card"]').filter({ has: page.getByText("Protected metadata", { exact: true }) })
    await expect(protectedCard.locator("pre")).toHaveText("null")
  })

  test("tabs are kept in the URL", async ({ page, api, ui }) => {
    const resource = await gotoResource(page, api, anna.name, { tab: "availability" })
    await expect(page.getByRole("tab", { name: "Availability" })).toHaveAttribute("aria-selected", "true")
    await expect(ui.main().getByText("Week overview")).toBeVisible()

    await page.reload()
    await expect(page.getByRole("tab", { name: "Availability" })).toHaveAttribute("aria-selected", "true")
    await expect(ui.main().getByText("Week overview")).toBeVisible()

    await ui.tab("Schedule blocks")
    await expect(page).toHaveURL(/[?&]tab=blocks/)
    await ui.tab("Recurring schedules")
    await expect(page).toHaveURL(/[?&]tab=recurring/)
    await ui.tab("Services")
    await expect(page).toHaveURL(/[?&]tab=services/)
    await ui.tab("JSON")
    await expect(page).toHaveURL(/[?&]tab=json/)
    await ui.tab("Overview")
    await expect(page).toHaveURL(new RegExp(`/resources/${resource.id}$`))
  })

  test("an unknown tab falls back to the overview", async ({ page, api, ui }) => {
    await gotoResource(page, api, anna.name, { tab: "bogus" })
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")
    await expect(detailValue(ui.main(), "Max simultaneous bookings")).toBeVisible()
  })

  test("links to the resource's bookings", async ({ page, api, ui }) => {
    const resource = await gotoResource(page, api, anna.name)
    const link = ui.main().getByRole("link", { name: "Bookings" })
    await expect(link).toHaveAttribute("href", `/bookings?resource=${resource.id}`)
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/bookings\\?resource=${resource.id}$`))
    await expect(ui.heading("Bookings")).toBeVisible()
  })

  test("disables and enables the resource", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, ben.name)
    const patch = net.waitFor("PATCH", `resources/${resource.id}`)
    await ui.main().getByRole("button", { name: "Disable" }).click()
    expect((await patch).body).toEqual({ enabled: false })
    await expectToast(page, "Resource disabled")
    await expect(ui.main().getByText("Disabled", { exact: true })).toBeVisible()
    expect((await api.get(`resources/${resource.id}`)).enabled).toBe(false)

    await ui.main().getByRole("button", { name: "Enable" }).click()
    await expectToast(page, "Resource enabled")
    await expect(ui.main().getByText("Enabled", { exact: true })).toBeVisible()
    await expect(ui.main().getByRole("button", { name: "Disable" })).toBeVisible()
  })

  test("deleting warns about the cascade and unlinks bookings and priorities", async ({ page, api, ui }) => {
    await gotoResource(page, api, anna.name)
    await ui.main().getByRole("button", { name: "Delete" }).click()
    const confirm = ui.alertDialog(`Delete ${anna.name}?`)
    await expect(confirm).toContainText(
      "This permanently deletes the resource together with its schedule blocks, recurring schedules and their blocks. Its bookings are kept but lose their resource. To keep history intact, consider disabling it instead."
    )
    await ui.confirm(`Delete ${anna.name}?`, "Delete resource")
    await expectToast(page, "Resource deleted")
    await expect(page).toHaveURL(/\/resources$/)
    await expect(ui.main().getByRole("cell", { name: ben.name, exact: true })).toBeVisible()
    await expect(ui.main().getByRole("cell", { name: anna.name, exact: true })).toHaveCount(0)

    const booking = await api.bookingFor("Erik Lund")
    expect(booking.resource ?? null).toBeNull()
    await page.goto(`/bookings/${booking.id}`)
    await expect(detailValue(ui.main(), "Resource")).toHaveText("No resource")

    const stockholm = await api.byName("locations", SEED.locations.stockholm.name)
    await page.goto(`/locations/${stockholm.id}`)
    await expect(detailValue(ui.main(), "Priority order").getByRole("listitem")).toHaveText([ben.name, roomA.name])
  })

  // BUG-02 (detail pages flash "Request failed (404)" after Delete) doesn't reproduce here: kept as a guard.
  test("never flashes a 404 error after deleting", async ({ page, api, ui }) => {
    await gotoResource(page, api, ben.name)
    const flashed = await recordAppearances(page, '[role="alert"]', "Request failed (404)")
    await ui.main().getByRole("button", { name: "Delete" }).click()
    await ui.confirm(`Delete ${ben.name}?`, "Delete resource")
    await expect(page).toHaveURL(/\/resources$/)
    await expect(ui.main().getByRole("cell", { name: anna.name, exact: true })).toBeVisible()
    expect(await flashed()).toBe(false)
  })

  test("keeps showing the resource when a refetch fails", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, anna.name)
    await net.fail(`resources/${resource.id}`, { method: "GET", status: 403, body: { message: "This action is unauthorized." } })
    const refetch = net.waitFor("GET", `resources/${resource.id}`)
    await refetchOnReconnect(page)
    await refetch
    await expect(ui.heading(anna.name)).toBeVisible()
    await expect(detailValue(ui.main(), "Max simultaneous bookings")).toHaveText("1One booking at a time.")
    await expect(ui.main().getByText("Request failed (403)")).toHaveCount(0)
  })

  test("a missing resource shows the 404 error", async ({ page, ui }) => {
    await page.goto("/resources/00000000-0000-4000-8000-000000000000")
    await expect(ui.main().getByRole("alert")).toContainText("Request failed (404)")
    await expect(ui.main().getByRole("alert")).toContainText("Not found.")
  })
})

test.describe("JSON tab", () => {
  test("shows the raw resource and replaces it with PUT", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, anna.name, { tab: "json" })
    await expect(ui.main().locator("pre")).toContainText(`"id": "${resource.id}"`)
    await ui.main().getByRole("button", { name: "Replace (PUT)" }).click()

    const dialog = ui.dialog("Replace via JSON")
    const textarea = dialog.getByRole("textbox", { name: "JSON body" })
    const initial = JSON.parse(await textarea.inputValue())
    expect(initial).toEqual({
      name: anna.name,
      max_simultaneous_bookings: 1,
      metadata: { role: "stylist", level: 3 },
      protected_metadata: null,
      enabled: true,
    })

    await textarea.fill(JSON.stringify({ ...initial, name: "Anna R", max_simultaneous_bookings: 4 }))
    const put = net.waitFor("PUT", `resources/${resource.id}`)
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    expect((await put).body).toEqual({ ...initial, name: "Anna R", max_simultaneous_bookings: 4 })
    await expectToast(page, "Resource replaced")
    await expect(dialog).toBeHidden()
    await expect(ui.heading("Anna R")).toBeVisible()
    await expect(ui.main().locator("pre")).toContainText('"max_simultaneous_bookings": 4')
  })

  test("refuses invalid JSON and shows API errors", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, anna.name, { tab: "json" })
    await ui.main().getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const textarea = dialog.getByRole("textbox", { name: "JSON body" })

    await textarea.fill("{ not json")
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    await expect(textarea).toHaveAttribute("aria-invalid", "true")
    await expect(dialog.locator("p.text-destructive")).toContainText("JSON")
    expect(net.find("PUT", `resources/${resource.id}`)).toHaveLength(0)

    await textarea.fill(JSON.stringify({ max_simultaneous_bookings: 0 }))
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    const alert = dialog.getByRole("alert")
    await expect(alert).toContainText("Request failed (422)")
    await expect(alert).toContainText("name: The name field is required.")
    await expect(alert).toContainText("max_simultaneous_bookings: The max simultaneous bookings must be at least 1.")
    await expect(dialog).toBeVisible()
    // Shown inline only, not as a toast as well.
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
    expect((await api.get(`resources/${resource.id}`)).name).toBe(anna.name)
  })
})

test.describe("detail of a new resource", () => {
  test("an unlimited resource without metadata", async ({ page, api, ui }) => {
    await createResource(api, { name: "Hall", max_simultaneous_bookings: null })
    await gotoResource(page, api, "Hall")
    await expect(detailValue(ui.main(), "Max simultaneous bookings")).toHaveText("UnlimitedAny number of bookings can overlap.")
    const metadata = ui.main().locator('[data-slot="card"]').filter({ has: page.getByText("Metadata", { exact: true }) })
    await expect(metadata.locator("pre")).toHaveText("null")
  })
})
