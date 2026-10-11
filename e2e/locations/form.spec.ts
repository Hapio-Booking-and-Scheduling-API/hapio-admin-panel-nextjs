import type { Locator, Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { expectAccessible } from "../helpers/a11y"
import { expectNoToast, expectToast } from "../helpers/toasts"
import type { Ui } from "../helpers/ui"
import { NEW_YORK, STOCKHOLM, formField, nameCells, type LocationJson } from "./_helpers"

const { anna, ben, roomA } = SEED.resources

/** Controls of the location form dialog. */
function form(dialog: Locator) {
  return {
    dialog,
    name: dialog.getByRole("textbox", { name: "Name", exact: true }),
    timeZone: dialog.getByRole("combobox", { name: "Time zone" }),
    strategy: dialog.getByRole("radiogroup", { name: "Resource selection" }),
    radio: (label: "Randomize" | "Prioritize" | "Equalize") => dialog.getByRole("radio", { name: new RegExp(`^${label}`) }),
    addPriority: dialog.getByRole("combobox", { name: "Add resource to priority" }),
    priorityItems: formField(dialog, "Priority order").locator("ol > li"),
    enabled: dialog.getByRole("switch", { name: "Enabled" }),
    metadata: dialog.getByRole("textbox", { name: "Metadata", exact: true }),
    protectedMetadata: dialog.getByRole("textbox", { name: "Protected metadata", exact: true }),
    error: (label: string) => formField(dialog, label).locator('[data-slot="field-error"]'),
    rejected: dialog.getByRole("alert").filter({ hasText: "Hapio rejected the request" }),
    cancel: dialog.getByRole("button", { name: "Cancel", exact: true }),
  }
}

async function openCreate(page: Page, ui: Ui) {
  await page.goto("/locations")
  await expect(ui.row(STOCKHOLM)).toBeVisible()
  await ui.main().getByRole("button", { name: "New location" }).click()
  const dialog = ui.dialog("New location")
  await expect(dialog).toBeVisible()
  return { ...form(dialog), submit: dialog.getByRole("button", { name: "Create location" }) }
}

async function openEdit(page: Page, ui: Ui, location: string) {
  await page.goto("/locations")
  await ui.rowAction(ui.row(location), "Edit")
  const dialog = ui.dialog("Edit location")
  await expect(dialog).toBeVisible()
  const f = form(dialog)
  await expect(f.name).toHaveValue(location)
  return { ...f, submit: dialog.getByRole("button", { name: "Save changes" }) }
}

const VALIDATION = { message: "The given data was invalid." }

test.describe("location form: create", () => {
  test("starts with sensible defaults", async ({ page, ui }) => {
    const f = await openCreate(page, ui)
    await expect(f.dialog).toContainText("Locations hold a time zone and decide how resources are picked for bookings.")
    await expect(f.name).toHaveValue("")
    await expect(f.name).toBeFocused()
    // The browser's own zone.
    await expect(f.timeZone).toHaveText("Europe/Stockholm")
    await expect(f.radio("Randomize")).toBeChecked()
    await expect(f.radio("Prioritize")).not.toBeChecked()
    await expect(f.radio("Equalize")).not.toBeChecked()
    await expect(f.addPriority).toHaveCount(0)
    await expect(f.enabled).toBeChecked()
    await expect(f.metadata).toHaveValue("")
    await expect(f.protectedMetadata).toHaveValue("")
    await expect(formField(f.dialog, "Metadata")).toContainText("Empty (null)")
    await expect(formField(f.dialog, "Metadata")).toContainText("0/1000")
    await expect(formField(f.dialog, "Protected metadata")).toContainText("Requires the location:protected_metadata ability.")
  })

  test("requires a name of at most 100 characters", async ({ page, ui, net }) => {
    const f = await openCreate(page, ui)
    await f.submit.click()
    await expect(f.error("Name")).toHaveText("Required")
    await expect(f.name).toHaveAttribute("aria-invalid", "true")

    await f.name.fill("   ")
    await f.submit.click()
    await expect(f.error("Name")).toHaveText("Required")

    await f.name.fill("x".repeat(101))
    await f.submit.click()
    await expect(f.error("Name")).toHaveText("At most 100 characters")

    // After the first submit, fixing the value clears the error right away.
    await f.name.fill("x".repeat(100))
    await expect(f.error("Name")).toHaveCount(0)
    await expect(f.name).not.toHaveAttribute("aria-invalid", "true")
    expect(net.find("POST", "locations")).toHaveLength(0)
    await expect(f.dialog).toBeVisible()
  })

  test("time zone can be searched and changed", async ({ page, ui, net }) => {
    const f = await openCreate(page, ui)
    await f.timeZone.click()
    const popover = page.locator('[data-slot="popover-content"]').last()
    await popover.locator('[data-slot="command-input"]').fill("zzzz-nowhere")
    await expect(popover.getByText("No matches.")).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(popover).toBeHidden()

    await ui.pick(f.timeZone, "Asia/Tokyo", { search: "tokyo" })
    await expect(f.timeZone).toHaveText("Asia/Tokyo")
    await f.name.fill("Tokyo Annex")
    const request = net.waitFor("POST", "locations")
    await f.submit.click()
    expect((await request).body).toMatchObject({ name: "Tokyo Annex", time_zone: "Asia/Tokyo" })
    await expectToast(page, "Location created")
  })

  test("Prioritize reveals the priority order, which can be built and reordered", async ({ page, ui }) => {
    const f = await openCreate(page, ui)
    await f.radio("Prioritize").click()
    await expect(f.radio("Prioritize")).toBeChecked()
    await expect(formField(f.dialog, "Priority order")).toContainText("Resources tried first to last.")
    await expect(f.priorityItems).toHaveCount(0)

    await ui.pick(f.addPriority, anna.name)
    await ui.pick(f.addPriority, ben.name)
    await expect(f.priorityItems).toHaveText([/^1\.\s*Anna/, /^2\.\s*Ben/])
    // Chosen resources leave the picker.
    await f.addPriority.click()
    const popover = page.locator('[data-slot="popover-content"]').last()
    await expect(popover.getByRole("option")).toHaveText([roomA.name])
    await page.keyboard.press("Escape")

    await expect(f.dialog.getByRole("button", { name: "Move Anna up" })).toBeDisabled()
    await expect(f.dialog.getByRole("button", { name: "Move Ben down" })).toBeDisabled()
    await f.dialog.getByRole("button", { name: "Move Ben up" }).click()
    await expect(f.priorityItems).toHaveText([/^1\.\s*Ben/, /^2\.\s*Anna/])
    await f.dialog.getByRole("button", { name: "Move Ben down" }).click()
    await expect(f.priorityItems).toHaveText([/^1\.\s*Anna/, /^2\.\s*Ben/])

    await f.dialog.getByRole("button", { name: "Remove Anna" }).click()
    await expect(f.priorityItems).toHaveText([/^1\.\s*Ben/])

    // Switching away hides the list.
    await f.radio("Equalize").click()
    await expect(f.addPriority).toHaveCount(0)
  })

  test("sends exactly what was entered and opens the new location", async ({ page, ui, api, net }) => {
    const [annaId, benId] = [await api.idOf("resources", anna.name), await api.idOf("resources", ben.name)]
    const f = await openCreate(page, ui)
    await f.name.fill("  Gothenburg Hall  ")
    await f.radio("Prioritize").click()
    await ui.pick(f.addPriority, ben.name)
    await ui.pick(f.addPriority, anna.name)
    await f.enabled.click()
    await expect(f.enabled).not.toBeChecked()
    await f.metadata.fill('{ "floor": 1, "tags": ["new"] }')
    await expect(formField(f.dialog, "Metadata")).toContainText("Valid JSON object")
    await expect(formField(f.dialog, "Metadata")).toContainText("26/1000")

    const request = net.waitFor("POST", "locations")
    await f.submit.click()
    const { body } = await request
    expect(body).toEqual({
      name: "Gothenburg Hall",
      time_zone: "Europe/Stockholm",
      resource_selection_strategy: "prioritize",
      resource_selection_priority: [benId, annaId],
      enabled: false,
      metadata: { floor: 1, tags: ["new"] },
    })
    // Empty protected metadata is left out entirely (it needs its own ability).
    expect(body).not.toHaveProperty("protected_metadata")

    await expectToast(page, "Location created", { type: "success" })
    const created = await api.byName<LocationJson>("locations", "Gothenburg Hall")
    await expect(page).toHaveURL(new RegExp(`/locations/${created.id}$`))
    await expect(ui.heading("Gothenburg Hall")).toBeVisible()
    await expect(f.dialog).toBeHidden()
  })

  test("sends protected metadata when it is filled in", async ({ page, ui, net }) => {
    const f = await openCreate(page, ui)
    await f.name.fill("Vault")
    await f.protectedMetadata.fill('{ "code": "1234" }')
    const request = net.waitFor("POST", "locations")
    await f.submit.click()
    expect((await request).body).toMatchObject({ name: "Vault", protected_metadata: { code: "1234" }, metadata: null })
    await expectToast(page, "Location created")
  })

  test("whitespace-only protected metadata is left out", async ({ page, ui, net }) => {
    const f = await openCreate(page, ui)
    await f.name.fill("Blank vault")
    await f.protectedMetadata.fill("   \n  ")
    await expect(formField(f.dialog, "Protected metadata")).toContainText("Empty (null)")
    const request = net.waitFor("POST", "locations")
    await f.submit.click()
    expect((await request).body).not.toHaveProperty("protected_metadata")
    await expectToast(page, "Location created")
  })

  test("metadata must be a JSON object of at most 1000 characters", async ({ page, ui, net }) => {
    const f = await openCreate(page, ui)
    const field = formField(f.dialog, "Metadata")
    await f.name.fill("Meta")

    await f.metadata.fill("{ not json")
    await expect(f.metadata).toHaveAttribute("aria-invalid", "true")
    await expect(field).not.toContainText("Valid JSON object")
    await f.submit.click()
    await expect(f.error("Metadata")).toHaveText(/JSON|token|property/i)

    await f.metadata.fill("[1, 2]")
    await expect(f.error("Metadata")).toHaveText("Metadata must be a JSON object.")

    await f.metadata.fill('"just text"')
    await expect(f.error("Metadata")).toHaveText("Metadata must be a JSON object.")

    // {"a":"…"} is 8 characters plus the value.
    await f.metadata.fill(JSON.stringify({ a: "x".repeat(993) }))
    await expect(f.error("Metadata")).toHaveText("Metadata can be at most 1000 characters when encoded.")

    await f.metadata.fill(JSON.stringify({ a: "x".repeat(992) }))
    await expect(f.error("Metadata")).toHaveCount(0)
    await expect(field).toContainText("1000/1000")

    // Protected metadata follows the same rules.
    await f.protectedMetadata.fill("[]")
    await f.submit.click()
    await expect(f.error("Protected metadata")).toHaveText("Metadata must be a JSON object.")
    expect(net.find("POST", "locations")).toHaveLength(0)
  })

  test("the length counter shows how far over the limit metadata is", async ({ page, ui }) => {
    const f = await openCreate(page, ui)
    await f.metadata.fill(JSON.stringify({ a: "x".repeat(993) }))
    await expect(formField(f.dialog, "Metadata")).toContainText("Metadata can be at most 1000 characters when encoded.")
    await expect(formField(f.dialog, "Metadata")).toContainText("1001/1000")
  })

  test("a 422 on a known field shows inline, without a toast", async ({ page, ui, net }) => {
    await net.fail("locations", {
      method: "POST",
      status: 422,
      body: { ...VALIDATION, errors: { name: ["The name has already been taken."] } },
    })
    const f = await openCreate(page, ui)
    await f.name.fill(STOCKHOLM)
    await f.submit.click()
    await expect(f.error("Name")).toHaveText("The name has already been taken.")
    await expect(f.rejected).toHaveCount(0)
    expect(await page.locator("[data-sonner-toast]").count()).toBe(0)
    await expect(f.dialog).toBeVisible()
    await expect(f.submit).toBeEnabled()
  })

  test("a 422 on an unknown key shows in the form's alert", async ({ page, ui, net }) => {
    await net.fail("locations", {
      method: "POST",
      status: 422,
      body: { ...VALIDATION, errors: { address: ["The address field is prohibited."] } },
    })
    const f = await openCreate(page, ui)
    await f.name.fill("Somewhere")
    await f.submit.click()
    await expect(f.rejected).toBeVisible()
    await expect(f.rejected).toContainText("The address field is prohibited.")
    expect(await page.locator("[data-sonner-toast]").count()).toBe(0)

    // Submitting again clears the alert first.
    await net.fail("locations", { method: "POST", status: 422, body: { ...VALIDATION, errors: { name: ["Taken."] } } })
    await f.submit.click()
    await expect(f.error("Name")).toHaveText("Taken.")
    await expect(f.rejected).toHaveCount(0)
  })

  test("a 422 for one priority entry shows under Priority order", async ({ page, ui, net }) => {
    await net.fail("locations", {
      method: "POST",
      status: 422,
      body: {
        ...VALIDATION,
        errors: { "resource_selection_priority.0": ["The selected resource_selection_priority.0 is invalid."] },
      },
    })
    const f = await openCreate(page, ui)
    await f.name.fill("Priority test")
    await f.radio("Prioritize").click()
    await ui.pick(f.addPriority, anna.name)
    await f.submit.click()
    await expect(formField(f.dialog, "Priority order")).toContainText(
      "The selected resource_selection_priority.0 is invalid."
    )
  })

  test("a 422 without field errors is toasted", async ({ page, ui, net }) => {
    await net.fail("locations", { method: "POST", status: 422, body: { message: "The location limit is reached." } })
    const f = await openCreate(page, ui)
    await f.name.fill("One too many")
    await f.submit.click()
    await expectToast(page, "The location limit is reached.", { type: "error", close: false })
    await expect(f.dialog).toBeVisible()
  })

  test("server and network errors are toasted and keep the dialog open", async ({ page, ui, net, api }) => {
    await net.fail("locations", { method: "POST", status: 500, body: { message: "Server Error" }, times: 1 })
    await net.abort("locations", { method: "POST", times: 1 })
    const f = await openCreate(page, ui)
    await f.name.fill("Flaky")
    await f.submit.click()
    // Later routes win in Playwright, so the network failure comes first.
    await expectToast(page, "Network error: could not reach the admin server.", { type: "error", close: false })
    await f.submit.click()
    await expectToast(page, "Server Error", { type: "error", close: false })
    await expect(f.dialog).toBeVisible()
    await expect(f.name).toHaveValue("Flaky")
    expect(await api.list("locations")).toHaveLength(2)
  })

  test("shows progress while saving and can't be closed meanwhile", async ({ page, ui, net }) => {
    await net.delay("locations", 1_000, { method: "POST" })
    const f = await openCreate(page, ui)
    await f.name.fill("Slow Studio")
    await f.submit.click()
    await expect(f.submit).toHaveAttribute("aria-busy", "true")
    await expect(f.submit).toBeDisabled()
    await expect(f.cancel).toBeDisabled()
    await page.keyboard.press("Escape")
    await expect(f.dialog).toBeVisible()
    await expectToast(page, "Location created")
    await expect(ui.heading("Slow Studio")).toBeVisible()
  })

  test("reopening starts from a clean form", async ({ page, ui }) => {
    const f = await openCreate(page, ui)
    await f.name.fill("Draft")
    await f.radio("Equalize").click()
    await f.metadata.fill("[")
    await f.submit.click()
    await expect(f.error("Metadata")).toBeVisible()
    await f.cancel.click()
    await expect(f.dialog).toBeHidden()

    await ui.main().getByRole("button", { name: "New location" }).click()
    await expect(f.dialog).toBeVisible()
    await expect(f.name).toHaveValue("")
    await expect(f.radio("Randomize")).toBeChecked()
    await expect(f.metadata).toHaveValue("")
    await expect(f.dialog.locator('[data-slot="field-error"]')).toHaveCount(0)

    // Escape resets too.
    await f.name.fill("Another draft")
    await page.keyboard.press("Escape")
    await expect(f.dialog).toBeHidden()
    await ui.main().getByRole("button", { name: "New location" }).click()
    await expect(f.name).toHaveValue("")
  })

  test("reopening clears server errors", async ({ page, ui, net }) => {
    await net.fail("locations", { method: "POST", status: 422, body: { ...VALIDATION, errors: { foo: ["Nope."] } } })
    const f = await openCreate(page, ui)
    await f.name.fill("Errors")
    await f.submit.click()
    await expect(f.rejected).toBeVisible()
    await f.cancel.click()
    await ui.main().getByRole("button", { name: "New location" }).click()
    await expect(f.dialog).toBeVisible()
    await expect(f.rejected).toHaveCount(0)
  })
})

test("after creating, coming back to the list offers a clean form", async ({ page, ui }) => {
  const f = await openCreate(page, ui)
  await f.name.fill("Gothenburg Hall")
  await f.radio("Equalize").click()
  await f.metadata.fill('{ "floor": 1 }')
  await f.submit.click()
  await expectToast(page, "Location created")
  await expect(ui.heading("Gothenburg Hall")).toBeVisible()

  await page.getByRole("navigation", { name: "breadcrumb" }).getByRole("link", { name: "Locations" }).click()
  await expect(ui.row("Gothenburg Hall")).toBeVisible()
  await ui.main().getByRole("button", { name: "New location" }).click()
  await expect(f.dialog).toBeVisible()
  await expect(f.name).toHaveValue("")
  await expect(f.radio("Randomize")).toBeChecked()
  await expect(f.metadata).toHaveValue("")
})

test.describe("location form: edit", () => {
  test("is prefilled from the location", async ({ page, ui }) => {
    const f = await openEdit(page, ui, STOCKHOLM)
    await expect(f.timeZone).toHaveText("Europe/Stockholm")
    await expect(f.radio("Prioritize")).toBeChecked()
    await expect(f.priorityItems).toHaveText([/Anna/, /Ben/, /Room A/])
    await expect(f.enabled).toBeChecked()
    expect(JSON.parse(await f.metadata.inputValue())).toEqual({ address: "Götgatan 12, Stockholm", floor: 2 })
    await expect(f.protectedMetadata).toHaveValue("")
  })

  test("changing only the name sends only the name", async ({ page, ui, api, net }) => {
    const id = await api.idOf("locations", STOCKHOLM)
    const f = await openEdit(page, ui, STOCKHOLM)
    await f.name.fill("Stockholm Atelier")
    const request = net.waitFor("PATCH", `locations/${id}`)
    await f.submit.click()
    expect((await request).body).toEqual({ name: "Stockholm Atelier" })
    await expectToast(page, "Location updated", { type: "success" })
    await expect(f.dialog).toBeHidden()
    await expect(nameCells(page)).toHaveText(["Stockholm Atelier", NEW_YORK])
    // Editing stays on the list.
    await expect(page).toHaveURL(/\/locations$/)
  })

  test("switching to Prioritize sends the strategy and the new order", async ({ page, ui, api, net }) => {
    const id = await api.idOf("locations", NEW_YORK)
    const [benId, roomId] = [await api.idOf("resources", ben.name), await api.idOf("resources", roomA.name)]
    const f = await openEdit(page, ui, NEW_YORK)
    await f.radio("Prioritize").click()
    await expect(f.priorityItems).toHaveCount(0)
    await ui.pick(f.addPriority, ben.name)
    await ui.pick(f.addPriority, roomA.name)
    const request = net.waitFor("PATCH", `locations/${id}`)
    await f.submit.click()
    expect((await request).body).toEqual({
      resource_selection_strategy: "prioritize",
      resource_selection_priority: [benId, roomId],
    })
    await expectToast(page, "Location updated")
    await expect(ui.row(NEW_YORK).getByText("Prioritize")).toBeVisible()
  })

  test("reordering sends only the priority list", async ({ page, ui, api, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    const [annaId, benId, roomId] = location.resource_selection_priority
    const f = await openEdit(page, ui, STOCKHOLM)
    await f.dialog.getByRole("button", { name: "Move Room A up" }).click()
    await expect(f.priorityItems).toHaveText([/Anna/, /Room A/, /Ben/])
    const request = net.waitFor("PATCH", `locations/${location.id}`)
    await f.submit.click()
    expect((await request).body).toEqual({ resource_selection_priority: [annaId, roomId, benId] })
    await expectToast(page, "Location updated")
    expect((await api.get<LocationJson>(`locations/${location.id}`)).resource_selection_priority).toEqual([
      annaId,
      roomId,
      benId,
    ])
  })

  test("removing from the priority sends the shorter list", async ({ page, ui, api, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    const [annaId, , roomId] = location.resource_selection_priority
    const f = await openEdit(page, ui, STOCKHOLM)
    await f.dialog.getByRole("button", { name: "Remove Ben" }).click()
    const request = net.waitFor("PATCH", `locations/${location.id}`)
    await f.submit.click()
    expect((await request).body).toEqual({ resource_selection_priority: [annaId, roomId] })
    await expectToast(page, "Location updated")
  })

  test("switching to Equalize sends only the strategy", async ({ page, ui, api, net }) => {
    const id = await api.idOf("locations", STOCKHOLM)
    const f = await openEdit(page, ui, STOCKHOLM)
    await f.radio("Equalize").click()
    await expect(f.addPriority).toHaveCount(0)
    const request = net.waitFor("PATCH", `locations/${id}`)
    await f.submit.click()
    expect((await request).body).toEqual({ resource_selection_strategy: "equalize" })
    await expectToast(page, "Location updated")
    await expect(ui.row(STOCKHOLM).getByText("Equalize")).toBeVisible()
  })

  test("metadata, time zone and enabled each send their own field", async ({ page, ui, api, net }) => {
    const id = await api.idOf("locations", NEW_YORK)
    let f = await openEdit(page, ui, NEW_YORK)
    await f.metadata.fill("")
    await f.enabled.click()
    let request = net.waitFor("PATCH", `locations/${id}`)
    await f.submit.click()
    expect((await request).body).toEqual({ metadata: null, enabled: false })
    await expectToast(page, "Location updated")

    await ui.rowAction(ui.row(NEW_YORK), "Edit")
    f = { ...form(ui.dialog("Edit location")), submit: ui.dialog("Edit location").getByRole("button", { name: "Save changes" }) }
    await expect(f.enabled).not.toBeChecked()
    await ui.pick(f.timeZone, "America/Chicago", { search: "Chicago" })
    await f.protectedMetadata.fill('{"vip":true}')
    request = net.waitFor("PATCH", `locations/${id}`)
    await f.submit.click()
    expect((await request).body).toEqual({ time_zone: "America/Chicago", protected_metadata: { vip: true } })
    await expectToast(page, "Location updated")
    await expect(ui.row(NEW_YORK).getByRole("cell", { name: "America/Chicago" })).toBeVisible()
  })

  test("a 422 on edit shows inline and keeps the input", async ({ page, ui, api, net }) => {
    const id = await api.idOf("locations", STOCKHOLM)
    await net.fail(`locations/${id}`, {
      method: "PATCH",
      status: 422,
      body: { ...VALIDATION, errors: { name: ["The name has already been taken."] } },
    })
    const f = await openEdit(page, ui, STOCKHOLM)
    await f.name.fill(NEW_YORK)
    await f.submit.click()
    await expect(f.error("Name")).toHaveText("The name has already been taken.")
    await expect(f.name).toHaveValue(NEW_YORK)
    await expectNoToast(page, "Location updated")
  })

  test("Cancel discards edits; reopening shows the saved values", async ({ page, ui, net }) => {
    const f = await openEdit(page, ui, STOCKHOLM)
    await f.name.fill("Not saved")
    await f.radio("Randomize").click()
    await f.cancel.click()
    await expect(f.dialog).toBeHidden()
    await ui.rowAction(ui.row(STOCKHOLM), "Edit")
    await expect(f.name).toHaveValue(STOCKHOLM)
    await expect(f.radio("Prioritize")).toBeChecked()
    expect(net.mutations()).toHaveLength(0)
  })

  test("saving without changes sends nothing", async ({ page, ui, net }) => {
    const f = await openEdit(page, ui, STOCKHOLM)
    await f.submit.click()
    await expectToast(page, "No changes to save", { type: "info" })
    await expect(f.dialog).toBeHidden()
    expect(net.find("PATCH", /^locations\//)).toHaveLength(0)
    await expectNoToast(page, "Location updated")
  })

  test("a change that is undone counts as no change", async ({ page, ui, net }) => {
    const f = await openEdit(page, ui, STOCKHOLM)
    await f.name.fill("Something else")
    await f.name.fill(STOCKHOLM)
    await f.submit.click()
    await expectToast(page, "No changes to save", { type: "info" })
    expect(net.find("PATCH", /^locations\//)).toHaveLength(0)
  })

  test("after saving, reopening the dialog shows the saved values and no pending changes", async ({ page, ui, api, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await page.goto(`/locations/${location.id}`)
    await expect(ui.heading(STOCKHOLM)).toBeVisible()
    const edit = ui.main().getByRole("button", { name: "Edit", exact: true })
    await edit.click()
    let f = { ...form(ui.dialog("Edit location")), submit: ui.dialog("Edit location").getByRole("button", { name: "Save changes" }) }
    await f.name.fill("Stockholm Atelier")
    await f.submit.click()
    await expectToast(page, "Location updated")
    await expect(ui.heading("Stockholm Atelier")).toBeVisible()

    await edit.click()
    f = { ...form(ui.dialog("Edit location")), submit: ui.dialog("Edit location").getByRole("button", { name: "Save changes" }) }
    await expect(f.name).toHaveValue("Stockholm Atelier")
    await f.enabled.click()
    const request = net.waitFor("PATCH", `locations/${location.id}`)
    await f.submit.click()
    // Only the new change, not the name saved before.
    expect((await request).body).toEqual({ enabled: false })
    await expectToast(page, "Location updated")
  })

  test("Cancel on the detail page discards edits", async ({ page, ui, api }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await page.goto(`/locations/${location.id}`)
    await expect(ui.heading(STOCKHOLM)).toBeVisible()
    const edit = ui.main().getByRole("button", { name: "Edit", exact: true })
    await edit.click()
    const f = form(ui.dialog("Edit location"))
    await f.name.fill("Not saved")
    await f.cancel.click()
    await expect(f.dialog).toBeHidden()
    await edit.click()
    await expect(f.name).toHaveValue(STOCKHOLM)
  })

  test("a background refetch keeps what is being typed", async ({ page, ui, api, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await page.goto(`/locations/${location.id}`)
    await expect(ui.heading(STOCKHOLM)).toBeVisible()
    await ui.main().getByRole("button", { name: "Edit", exact: true }).click()
    const dialog = ui.dialog("Edit location")
    const f = { ...form(dialog), submit: dialog.getByRole("button", { name: "Save changes" }) }
    await expect(f.name).toHaveValue(STOCKHOLM)
    await f.name.fill("Typed but not saved")

    // Someone else changes the location; the panel refetches when the browser comes back online.
    await api.patch(`locations/${location.id}`, { metadata: { ...location.metadata, refetched: true } })
    await page.clock.fastForward(31_000)
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"))
      window.dispatchEvent(new Event("online"))
    })
    // The page behind the dialog shows the refetched data…
    // (the page is aria-hidden behind the modal, so it is located by CSS).
    await expect(page.locator("main pre").first()).toContainText('"refetched": true')
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))))
    // …and the dialog still has the user's input, while untouched fields follow the server.
    await expect(f.name).toHaveValue("Typed but not saved")
    await expect(f.metadata).toHaveValue(/"refetched": true/)

    // Saving sends only what the user changed.
    const request = net.waitFor("PATCH", `locations/${location.id}`)
    await f.submit.click()
    expect((await request).body).toEqual({ name: "Typed but not saved" })
    await expectToast(page, "Location updated")
    const saved = await api.get<LocationJson>(`locations/${location.id}`)
    expect(saved).toMatchObject({ name: "Typed but not saved", metadata: { refetched: true } })
  })
})

test("form labels: radio options are described", async ({ page, ui }) => {
  const f = await openCreate(page, ui)
  await expect(f.strategy.getByRole("radio")).toHaveCount(3)
  await expect(f.radio("Prioritize")).toHaveAccessibleName(
    /^Prioritize\s*Pick resources in a fixed order; unlisted resources follow, sorted by ID\.$/
  )
})

test("the form dialog has no serious accessibility violations", async ({ page, ui }) => {
  const f = await openCreate(page, ui)
  await f.radio("Prioritize").click()
  await ui.pick(f.addPriority, anna.name)
  await expectAccessible(page, { include: '[role="dialog"]' })
})

test("validation errors are readable (contrast)", async ({ page, ui }) => {
  const f = await openCreate(page, ui)
  await f.submit.click()
  await expect(f.error("Name")).toHaveText("Required")
  await expectAccessible(page, { include: '[role="dialog"]' })
})
