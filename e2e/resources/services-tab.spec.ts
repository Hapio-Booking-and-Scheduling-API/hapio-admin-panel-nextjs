import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { expectToast } from "../helpers/toasts"
import { createResource, gotoResource, wallDateTime } from "./_helpers"

const { anna } = SEED.resources
const { haircut, studio, equipment } = SEED.services

interface Association {
  service_id: string
  created_at: string
}

test.describe("resource services tab", () => {
  test("lists the associated services with type, status and date", async ({ page, api, ui }) => {
    const resource = await api.byName("resources", anna.name)
    const associations = await api.get<Association[]>(`resources/${resource.id}/services`)
    const haircutService = await api.byName("services", haircut.name)
    const studioService = await api.byName("services", studio.name)
    await gotoResource(page, api, anna.name, { tab: "services" })

    const table = ui.main().getByRole("table")
    await expect(table.getByRole("link", { name: haircut.name })).toHaveAttribute("href", `/services/${haircutService.id}`)
    await expect(table.getByRole("link", { name: studio.name })).toHaveAttribute("href", `/services/${studioService.id}`)
    await ui.expectRowCount(2, table)
    await expect(table.getByRole("columnheader")).toHaveText(["Service", "Type", "Status", "Associated", "Actions"])

    const haircutRow = ui.row(haircut.name)
    await expect(haircutRow.getByRole("cell")).toHaveText([
      haircut.name,
      "Fixed",
      "Enabled",
      wallDateTime(associations.find((a) => a.service_id === haircutService.id)!.created_at),
      "",
    ])
    await expect(ui.row(studio.name).getByRole("cell").nth(1)).toHaveText("Flexible")

    await table.getByRole("link", { name: haircut.name }).click()
    await expect(page).toHaveURL(new RegExp(`/services/${haircutService.id}$`))
    await expect(ui.heading(haircut.name)).toBeVisible()
  })

  test("shows a disabled service's status", async ({ page, api, ui }) => {
    await api.patch(`services/${await api.idOf("services", studio.name)}`, { enabled: false })
    await gotoResource(page, api, anna.name, { tab: "services" })
    await expect(ui.row(studio.name).getByRole("cell").nth(2)).toHaveText("Disabled")
  })

  test("the picker offers only services that aren't associated yet", async ({ page, api, ui }) => {
    await gotoResource(page, api, anna.name, { tab: "services" })
    await expect(ui.main().getByRole("link", { name: haircut.name })).toBeVisible()
    await ui.main().getByRole("combobox", { name: "Service to associate" }).click()
    const popover = page.locator('[data-slot="popover-content"]').last()
    await expect(popover.getByRole("option")).toHaveCount(1)
    await expect(popover.getByRole("option")).toContainText(equipment.name)
    await expect(popover.getByRole("option")).toContainText("Day")
    await page.keyboard.press("Escape")
  })

  test("associates a service", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, anna.name, { tab: "services" })
    const equipmentId = await api.idOf("services", equipment.name)
    await expect(ui.main().getByRole("link", { name: haircut.name })).toBeVisible()

    const put = net.waitFor("PUT", `resources/${resource.id}/services/${equipmentId}`)
    await ui.pick(ui.main().getByRole("combobox", { name: "Service to associate" }), equipment.name)
    await put
    await expectToast(page, `${equipment.name} associated`, { type: "success" })
    await expect(ui.main().getByRole("link", { name: equipment.name })).toBeVisible()
    await ui.expectRowCount(3, ui.main().getByRole("table"))
    const associations = await api.get<Association[]>(`resources/${resource.id}/services`)
    expect(associations.map((a) => a.service_id)).toContain(equipmentId)

    // Everything is associated now: the picker has nothing left to offer.
    await ui.main().getByRole("combobox", { name: "Service to associate" }).click()
    const popover = page.locator('[data-slot="popover-content"]').last()
    await expect(popover.getByText("No services found.")).toBeVisible()
    await page.keyboard.press("Escape")
  })

  test("removes an association after confirming", async ({ page, api, ui, net }) => {
    const resource = await gotoResource(page, api, anna.name, { tab: "services" })
    const haircutId = await api.idOf("services", haircut.name)
    await ui.main().getByRole("button", { name: `Remove ${haircut.name}` }).click()

    const confirm = ui.alertDialog(`Remove ${haircut.name}?`)
    await expect(confirm).toContainText("The resource can no longer be booked for this service.")
    await ui.dismiss(`Remove ${haircut.name}?`)
    await expect(ui.main().getByRole("link", { name: haircut.name })).toBeVisible()

    await ui.main().getByRole("button", { name: `Remove ${haircut.name}` }).click()
    const del = net.waitFor("DELETE", `resources/${resource.id}/services/${haircutId}`)
    await ui.confirm(`Remove ${haircut.name}?`, "Remove")
    await del
    await expectToast(page, `${haircut.name} removed`)
    await expect(ui.main().getByRole("link", { name: haircut.name })).toHaveCount(0)
    const associations = await api.get<Association[]>(`resources/${resource.id}/services`)
    expect(associations.map((a) => a.service_id)).not.toContain(haircutId)
  })

  test("a resource without services shows the empty state", async ({ page, api, ui }) => {
    await createResource(api, { name: "Studio C" })
    await gotoResource(page, api, "Studio C", { tab: "services" })
    const empty = ui.main().locator('[data-slot="empty"]')
    await expect(empty).toContainText("No services")
    await expect(empty).toContainText("Associate a service so this resource can be booked for it.")
    await ui.main().getByRole("combobox", { name: "Service to associate" }).click()
    await expect(page.locator('[data-slot="popover-content"]').last().getByRole("option")).toHaveCount(3)
    await page.keyboard.press("Escape")
  })

  test("a failed association shows an error and keeps the list", async ({ page, api, ui, net }) => {
    await net.fail(/^resources\/[^/]+\/services\/[^/]+$/, { method: "PUT", status: 500, body: { message: "Server Error" } })
    await gotoResource(page, api, anna.name, { tab: "services" })
    await expect(ui.main().getByRole("link", { name: haircut.name })).toBeVisible()
    await ui.pick(ui.main().getByRole("combobox", { name: "Service to associate" }), equipment.name)
    await expectToast(page, "Server Error", { type: "error" })
    await ui.expectRowCount(2, ui.main().getByRole("table"))
    await expect(ui.main().getByRole("combobox", { name: "Service to associate" })).toBeEnabled()
  })

  test("a failed load shows the error with a retry", async ({ page, api, ui, net }) => {
    await net.fail(/^resources\/[^/]+\/services$/, { method: "GET", status: 403, body: { message: "This action is unauthorized." }, times: 1 })
    await gotoResource(page, api, anna.name, { tab: "services" })
    const alert = ui.main().getByRole("alert")
    await expect(alert).toContainText("Request failed (403)")
    await expect(alert).toContainText("This action is unauthorized.")
    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(ui.main().getByRole("link", { name: haircut.name })).toBeVisible()
  })
})
