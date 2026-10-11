import type { Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { expectAccessible } from "../helpers/a11y"
import { recordAppearances } from "../helpers/flash"
import { expectToast } from "../helpers/toasts"
import type { Ui } from "../helpers/ui"
import {
  NEW_YORK,
  STOCKHOLM,
  detailValue,
  nameCells,
  sectionCard,
  slowNavigationTo,
  wallTimeWithOffset,
  type LocationJson,
} from "./_helpers"

const { anna, ben, roomA } = SEED.resources

async function openDetail(page: Page, ui: Ui, location: LocationJson) {
  await page.goto(`/locations/${location.id}`)
  await expect(ui.heading(location.name)).toBeVisible()
}

const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

/** The location without its read-only fields. */
const writable = (l: LocationJson) =>
  Object.fromEntries(Object.entries(l).filter(([key]) => !["id", "created_at", "updated_at"].includes(key)))

test.describe("location detail: overview", () => {
  test("header shows the name, status, ID and actions", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await expect(ui.main().getByText("Enabled", { exact: true })).toBeVisible()
    await expect(ui.main().getByText(location.id, { exact: true })).toBeVisible()
    for (const name of ["Bookings", "Disable", "Edit", "Delete"]) {
      await expect(ui.main().getByRole(name === "Bookings" ? "link" : "button", { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText(STOCKHOLM)
    await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")
  })

  test("Copy ID puts the ID on the clipboard", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.main().getByRole("button", { name: "Copy ID" }).click()
    await expect.poll(() => readClipboard(page)).toBe(location.id)
  })

  test("details list the zone, strategy and timestamps with their offset", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await expect(detailValue(page, "Time zone")).toHaveText("Europe/Stockholm")
    await expect(detailValue(page, "Resource selection")).toHaveText(
      /^Prioritize\s*Pick resources in a fixed order; unlisted resources follow, sorted by ID\.$/
    )
    await expect(detailValue(page, "Created")).toHaveText(wallTimeWithOffset(location.created_at))
    await expect(detailValue(page, "Updated")).toHaveText(wallTimeWithOffset(location.updated_at))
    // The mock returns timestamps in UTC.
    await expect(detailValue(page, "Created")).toHaveText(/\(UTC\)$/)
  })

  test("priority order links to each resource, in order", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    const ids = [await api.idOf("resources", anna.name), await api.idOf("resources", ben.name), await api.idOf("resources", roomA.name)]
    expect(location.resource_selection_priority).toEqual(ids)
    await openDetail(page, ui, location)
    const links = detailValue(page, "Priority order").getByRole("link")
    await expect(links).toHaveText(SEED.priority)
    for (const [i, id] of ids.entries()) await expect(links.nth(i)).toHaveAttribute("href", `/resources/${id}`)

    await links.filter({ hasText: ben.name }).click()
    await expect(page).toHaveURL(new RegExp(`/resources/${ids[1]}$`))
    await expect(ui.heading(ben.name)).toBeVisible()
  })

  test("a priority entry for an unknown resource shows its ID", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    const ghost = "00000000-0000-4000-8000-000000000000"
    await api.patch(`locations/${location.id}`, { resource_selection_priority: [location.resource_selection_priority[0], ghost] })
    await openDetail(page, ui, location)
    await expect(detailValue(page, "Priority order").getByRole("link")).toHaveText([anna.name, ghost])
  })

  test("randomize hides the priority row", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", NEW_YORK)
    await openDetail(page, ui, location)
    await expect(detailValue(page, "Time zone")).toHaveText("America/New_York")
    await expect(detailValue(page, "Resource selection")).toHaveText(/^Randomize\s*Pick a random available resource\.$/)
    await expect(detailValue(page, "Priority order")).toHaveCount(0)
  })

  test("prioritize without a list explains the fallback", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", NEW_YORK)
    await api.patch(`locations/${location.id}`, { resource_selection_strategy: "prioritize", resource_selection_priority: [] })
    await openDetail(page, ui, location)
    await expect(detailValue(page, "Priority order")).toHaveText("No priority set; resources are ordered by ID.")
  })

  test("metadata blocks show the JSON", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await api.patch(`locations/${location.id}`, { protected_metadata: { door_code: "4711" } })
    await openDetail(page, ui, location)
    const metadata = sectionCard(page, "Metadata").locator("pre")
    await expect(metadata).toContainText('"floor": 2')
    expect(JSON.parse((await metadata.textContent()) ?? "")).toEqual(location.metadata)
    const protectedBlock = sectionCard(page, "Protected metadata")
    await expect(protectedBlock.locator("pre")).toContainText('"door_code": "4711"')
    await expect(protectedBlock).not.toContainText("Not returned")
  })

  test("null metadata shows null", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", NEW_YORK)
    await api.patch(`locations/${location.id}`, { metadata: null })
    await openDetail(page, ui, location)
    await expect(sectionCard(page, "Metadata").locator("pre")).toHaveText("null")
    await expect(sectionCard(page, "Protected metadata").locator("pre")).toHaveText("null")
  })

  test("explains a missing protected_metadata (token without the ability)", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await net.transform(
      `locations/${location.id}`,
      (json) => {
        const stripped = { ...(json as LocationJson) }
        delete stripped.protected_metadata
        return stripped
      },
      { method: "GET" }
    )
    await openDetail(page, ui, location)
    const card = sectionCard(page, "Protected metadata")
    await expect(card).toContainText("Not returned: the token lacks location:protected_metadata.")
    await expect(card.locator("pre")).toHaveText("null")
  })

  test("Bookings opens the bookings list filtered to this location", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    const link = ui.main().getByRole("link", { name: "Bookings", exact: true })
    await expect(link).toHaveAttribute("href", `/bookings?location=${location.id}`)
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/bookings\\?location=${location.id}`))
    await expect(page.getByRole("combobox", { name: "Location filter" })).toHaveText(STOCKHOLM)
  })

  test("an unknown ID shows a 404 with Retry", async ({ page, ui }) => {
    await page.goto("/locations/00000000-0000-4000-8000-000000000000")
    const alert = ui.main().getByRole("alert")
    await expect(alert).toContainText("Request failed (404)")
    await expect(alert).toContainText("Not found.")
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible()
  })
})

test.describe("location detail: actions", () => {
  test("Disable, then Enable", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)

    let request = net.waitFor("PATCH", `locations/${location.id}`)
    await ui.main().getByRole("button", { name: "Disable", exact: true }).click()
    expect((await request).body).toEqual({ enabled: false })
    await expectToast(page, "Location disabled", { type: "success" })
    await expect(ui.main().getByText("Disabled", { exact: true })).toBeVisible()
    expect((await api.get<LocationJson>(`locations/${location.id}`)).enabled).toBe(false)

    request = net.waitFor("PATCH", `locations/${location.id}`)
    await ui.main().getByRole("button", { name: "Enable", exact: true }).click()
    expect((await request).body).toEqual({ enabled: true })
    await expectToast(page, "Location enabled", { type: "success" })
    await expect(ui.main().getByText("Enabled", { exact: true })).toBeVisible()
    await expect(ui.main().getByRole("button", { name: "Disable", exact: true })).toBeVisible()
  })

  test("the toggle is disabled while saving", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await net.delay(`locations/${location.id}`, 1_000, { method: "PATCH" })
    await openDetail(page, ui, location)
    const button = ui.main().getByRole("button", { name: "Disable", exact: true })
    await button.click()
    await expect(button).toBeDisabled()
    await expectToast(page, "Location disabled")
  })

  test("Edit saves and updates the page", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.main().getByRole("button", { name: "Edit", exact: true }).click()
    const dialog = ui.dialog("Edit location")
    const name = dialog.getByRole("textbox", { name: "Name", exact: true })
    await expect(name).toHaveValue(STOCKHOLM)
    await name.fill("Stockholm Atelier")
    const request = net.waitFor("PATCH", `locations/${location.id}`)
    await dialog.getByRole("button", { name: "Save changes" }).click()
    expect((await request).body).toEqual({ name: "Stockholm Atelier" })
    await expectToast(page, "Location updated", { type: "success" })
    await expect(dialog).toBeHidden()
    await expect(ui.heading("Stockholm Atelier")).toBeVisible()
    await expect(page.getByRole("navigation", { name: "breadcrumb" })).toContainText("Stockholm Atelier")
    const saved = await api.get<LocationJson>(`locations/${location.id}`)
    await expect(detailValue(page, "Updated")).toHaveText(wallTimeWithOffset(saved.updated_at))
    // Editing stays on the detail page.
    await expect(page).toHaveURL(new RegExp(`/locations/${location.id}$`))
  })

  test("Delete asks first, then returns to the list", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    const dialog = ui.alertDialog(`Delete ${STOCKHOLM}?`)
    await expect(dialog).toContainText("Consider disabling it instead.")
    const request = net.waitFor("DELETE", `locations/${location.id}`)
    await ui.confirm(`Delete ${STOCKHOLM}?`, "Delete location")
    await request
    await expectToast(page, "Location deleted", { type: "success" })
    await expect(page).toHaveURL(/\/locations$/)
    await expect(nameCells(page)).toHaveText([NEW_YORK])
    expect((await api.list<LocationJson>("locations")).map((l) => l.name)).toEqual([NEW_YORK])
  })

  test("Cancel keeps the location", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    await ui.dismiss(`Delete ${STOCKHOLM}?`)
    await expect(ui.heading(STOCKHOLM)).toBeVisible()
    expect(net.find("DELETE", /^locations\//)).toHaveLength(0)
  })

  test("a failed delete stays on the page", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await net.fail(`locations/${location.id}`, { method: "DELETE", status: 500, body: { message: "Server Error" } })
    await openDetail(page, ui, location)
    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    const dialog = ui.alertDialog(`Delete ${STOCKHOLM}?`)
    await dialog.getByRole("button", { name: "Delete location" }).click()
    await expectToast(page, "Server Error", { type: "error", close: false })
    await expect(dialog).toBeVisible()
    await ui.dismiss(`Delete ${STOCKHOLM}?`)
    await expect(page).toHaveURL(new RegExp(`/locations/${location.id}$`))
  })

  test("deleting never flashes a 404 error", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    // On a slow connection a refetch of the deleted location would land before the list does.
    await slowNavigationTo(page, "/locations")
    await openDetail(page, ui, location)
    const appeared = await recordAppearances(page, '[data-slot="alert"]', "Request failed (404)")
    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    const deleted = net.waitFor("DELETE", `locations/${location.id}`)
    await ui.confirm(`Delete ${STOCKHOLM}?`, "Delete location")
    const deleteCall = await deleted
    await expectToast(page, "Location deleted")
    await expect(nameCells(page)).toHaveText([NEW_YORK])
    expect(await appeared()).toBe(false)
    // The deleted location is never fetched again.
    const after = net.calls.slice(net.calls.findIndex((c) => c.request === deleteCall.request) + 1)
    expect(after.filter((c) => c.method === "GET" && c.path === `locations/${location.id}`)).toEqual([])
  })

  test("going back to a deleted location shows the 404", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.main().getByRole("button", { name: "Delete", exact: true }).click()
    await ui.confirm(`Delete ${STOCKHOLM}?`, "Delete location")
    await expectToast(page, "Location deleted")
    await expect(nameCells(page)).toHaveText([NEW_YORK])

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/locations/${location.id}$`))
    await expect(ui.main().getByRole("alert")).toContainText("Request failed (404)")
    await expect(ui.heading(STOCKHOLM)).toHaveCount(0)
  })

  test("a failed refetch keeps showing the location", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await net.fail(`locations/${location.id}`, { method: "GET", status: 500, body: { message: "Server Error" } })
    // Any mutation refreshes every query; this one refetches the location, which fails.
    const refetch = net.waitFor("GET", `locations/${location.id}`)
    await ui.main().getByRole("button", { name: "Disable", exact: true }).click()
    await refetch
    await expectToast(page, "Location disabled")
    await expect(ui.heading(STOCKHOLM)).toBeVisible()
    await expect(detailValue(page, "Time zone")).toHaveText("Europe/Stockholm")
    await expect(ui.main().getByRole("alert")).toHaveCount(0)
  })
})

test.describe("location detail: JSON", () => {
  test("shows the raw response and copies it", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.tab("JSON")
    const card = page.getByRole("tabpanel", { name: "JSON" })
    await expect(card).toContainText("The raw API response.")
    await expect(card.locator("pre")).toContainText(`"id": "${location.id}"`)
    await card.getByRole("button", { name: "Copy" }).click()
    await expect.poll(async () => JSON.parse(await readClipboard(page))).toEqual(location)
    expect(await readClipboard(page)).toBe(JSON.stringify(location, null, 2))
  })

  test("Replace (PUT) is prefilled with the writable fields only", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    await expect(dialog).toContainText("Fields you leave out are reset to their defaults.")
    const body = dialog.getByRole("textbox", { name: "JSON body" })
    await expect(body).toHaveValue(/"name": "Stockholm Studio"/)
    const prefilled = JSON.parse(await body.inputValue())
    expect(prefilled).toEqual(writable(location))
    expect(Object.keys(prefilled)).not.toEqual(expect.arrayContaining(["id"]))
    for (const key of ["id", "created_at", "updated_at"]) expect(prefilled).not.toHaveProperty(key)
  })

  test("invalid JSON shows a parse error and sends nothing", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const body = dialog.getByRole("textbox", { name: "JSON body" })
    await body.fill("{ not json")
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    await expect(body).toHaveAttribute("aria-invalid", "true")
    await expect(dialog).toContainText(/JSON/)
    await expect(dialog).toBeVisible()
    expect(net.find("PUT", /^locations\//)).toHaveLength(0)

    // Fixing it clears the error on the next attempt.
    await body.fill(JSON.stringify(writable(location)))
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    await expectToast(page, "Location replaced")
    await expect(dialog).toBeHidden()
  })

  test("a 422 shows the field errors inside the dialog", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    await dialog
      .getByRole("textbox", { name: "JSON body" })
      .fill(JSON.stringify({ ...writable(location), time_zone: "Mars/Olympus_Mons" }))
    const request = net.waitFor("PUT", `locations/${location.id}`)
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    expect((await request).body).toMatchObject({ time_zone: "Mars/Olympus_Mons" })
    const alert = dialog.getByRole("alert")
    await expect(alert).toContainText("Request failed (422)")
    await expect(alert).toContainText("The given data was invalid.")
    await expect(alert.getByRole("listitem")).toHaveText(["time_zone: The time zone must be a valid timezone."])
    await expect(dialog).toBeVisible()
    expect((await api.get<LocationJson>(`locations/${location.id}`)).time_zone).toBe("Europe/Stockholm")
  })

  test("a 422 is reported once, inside the dialog", async ({ page, api, ui }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    await dialog
      .getByRole("textbox", { name: "JSON body" })
      .fill(JSON.stringify({ ...writable(location), time_zone: "Mars/Olympus_Mons" }))
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    await expect(dialog.getByRole("alert")).toContainText("Request failed (422)")
    // The toast, if any, is raised before the dialog shows the error.
    expect(await page.locator("[data-sonner-toast]").count()).toBe(0)
  })

  test("a successful replace updates the page", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const next = { ...writable(location), name: "Stockholm Replaced", resource_selection_strategy: "equalize" }
    await dialog.getByRole("textbox", { name: "JSON body" }).fill(JSON.stringify(next, null, 2))
    const request = net.waitFor("PUT", `locations/${location.id}`)
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    expect((await request).body).toEqual(next)
    await expectToast(page, "Location replaced", { type: "success" })
    await expect(dialog).toBeHidden()
    await expect(ui.heading("Stockholm Replaced")).toBeVisible()
    await expect(page.getByRole("tabpanel", { name: "JSON" }).locator("pre")).toContainText('"name": "Stockholm Replaced"')
    await ui.tab("Overview")
    await expect(detailValue(page, "Resource selection")).toHaveText(/^Equalize/)
    await expect(detailValue(page, "Priority order")).toHaveCount(0)
  })

  test("shows progress while replacing", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await net.delay(`locations/${location.id}`, 1_000, { method: "PUT" })
    await openDetail(page, ui, location)
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const replace = dialog.getByRole("button", { name: "Replace", exact: true })
    await replace.click()
    await expect(replace).toHaveAttribute("aria-busy", "true")
    await expect(replace).toBeDisabled()
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled()
    await expectToast(page, "Location replaced")
    await expect(dialog).toBeHidden()
  })

  test("Cancel closes without sending, and reopening starts fresh", async ({ page, api, ui, net }) => {
    const location = await api.byName<LocationJson>("locations", STOCKHOLM)
    await openDetail(page, ui, location)
    await ui.tab("JSON")
    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    const dialog = ui.dialog("Replace via JSON")
    const body = dialog.getByRole("textbox", { name: "JSON body" })
    await body.fill("{ half edited")
    await dialog.getByRole("button", { name: "Replace", exact: true }).click()
    await expect(body).toHaveAttribute("aria-invalid", "true")
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    expect(net.find("PUT", /^locations\//)).toHaveLength(0)

    await page.getByRole("button", { name: "Replace (PUT)" }).click()
    expect(JSON.parse(await body.inputValue())).toEqual(writable(location))
    await expect(body).not.toHaveAttribute("aria-invalid", "true")
  })
})

test("the detail page has no serious accessibility violations", async ({ page, api, ui }) => {
  const location = await api.byName<LocationJson>("locations", STOCKHOLM)
  await openDetail(page, ui, location)
  await expectAccessible(page, { include: "main" })
})

test("the Replace dialog has no serious accessibility violations", async ({ page, api, ui }) => {
  const location = await api.byName<LocationJson>("locations", STOCKHOLM)
  await openDetail(page, ui, location)
  await ui.tab("JSON")
  await page.getByRole("button", { name: "Replace (PUT)" }).click()
  await expect(ui.dialog("Replace via JSON")).toBeVisible()
  await expectAccessible(page, { include: '[role="dialog"]' })
})
