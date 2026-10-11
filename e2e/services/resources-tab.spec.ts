import type { Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { expectToast } from "../helpers/toasts"
import { gotoService } from "./_helpers"

const { haircut, equipment } = SEED.services
const { anna, ben, roomA } = SEED.resources

const resourcesTable = (page: Page) => page.getByRole("tabpanel").getByRole("table")
const resourceNames = (page: Page) => resourcesTable(page).locator("tbody tr td:first-child")
const resourcesTab = (page: Page) => page.getByRole("tab", { name: /^Resources/ })

test.describe("service resources tab", () => {
  test("lists the associated resources by name", async ({ page, api }) => {
    await gotoService(page, api, haircut.name, "resources")
    await expect(resourceNames(page)).toHaveText([anna.name, ben.name, roomA.name])
    await expect(resourcesTable(page).getByRole("columnheader")).toHaveText(["Resource", "Status", "Associated", "Actions"])
    const annaRow = resourcesTable(page).getByRole("row").filter({ hasText: anna.name })
    await expect(annaRow).toContainText("Enabled")
    const annaId = await api.idOf("resources", anna.name)
    await expect(annaRow.getByRole("link", { name: anna.name })).toHaveAttribute("href", `/resources/${annaId}`)
  })

  test("shows a disabled resource as disabled", async ({ page, api }) => {
    const benId = await api.idOf("resources", ben.name)
    await api.patch(`resources/${benId}`, { enabled: false })
    await gotoService(page, api, haircut.name, "resources")
    await expect(resourcesTable(page).getByRole("row").filter({ hasText: ben.name })).toContainText("Disabled")
  })

  test("associates a resource", async ({ page, api, net }) => {
    const service = await gotoService(page, api, equipment.name, "resources")
    await expect(resourceNames(page)).toHaveText([roomA.name])
    const associate = page.getByRole("button", { name: "Associate resource" })
    await expect(associate).toBeDisabled()

    const picker = page.getByRole("combobox", { name: "Resource to associate" })
    await picker.click()
    const popover = page.locator('[data-slot="popover-content"]').last()
    // Already associated resources aren't offered.
    await expect(popover.getByRole("option")).toHaveText([anna.name, ben.name])
    await popover.getByRole("option", { name: anna.name }).click()
    await expect(picker).toHaveText(anna.name)
    await expect(associate).toBeEnabled()

    const annaId = await api.idOf("resources", anna.name)
    const put = net.waitFor("PUT", `services/${service.id}/resources/${annaId}`)
    await associate.click()
    await put
    await expectToast(page, `${anna.name} can now deliver this service`, { type: "success" })
    await expect(resourceNames(page)).toHaveText([anna.name, roomA.name])
    await expect(resourcesTab(page)).toHaveText(/^Resources\s*2$/)
    await expect(picker).toHaveText("Select a resource to associate…")
    const associated = await api.get<Array<{ resource_id: string }>>(`services/${service.id}/resources`)
    expect(associated.map((a) => a.resource_id)).toContain(annaId)
  })

  test("removes a resource after confirming", async ({ page, api, net, ui }) => {
    const service = await gotoService(page, api, haircut.name, "resources")
    const remove = page.getByRole("button", { name: `Remove ${ben.name} from this service` })
    await remove.click()
    const confirm = ui.alertDialog(`Remove ${ben.name} from this service?`)
    await expect(confirm).toContainText("The resource itself and existing bookings are not deleted.")
    await ui.dismiss(`Remove ${ben.name} from this service?`)
    await expect(resourceNames(page)).toHaveText([anna.name, ben.name, roomA.name])

    const benId = await api.idOf("resources", ben.name)
    await remove.click()
    const request = net.waitFor("DELETE", `services/${service.id}/resources/${benId}`)
    await ui.confirm(`Remove ${ben.name} from this service?`, "Remove")
    await request
    await expectToast(page, `${ben.name} removed from this service`, { type: "success" })
    await expect(resourceNames(page)).toHaveText([anna.name, roomA.name])
    await expect(resourcesTab(page)).toHaveText(/^Resources\s*2$/)
    const associated = await api.get<Array<{ resource_id: string }>>(`services/${service.id}/resources`)
    expect(associated.map((a) => a.resource_id)).not.toContain(benId)
  })

  test("a failed association shows the error and keeps the selection", async ({ page, api, net }) => {
    const service = await gotoService(page, api, equipment.name, "resources")
    await net.fail(new RegExp(`^services/${service.id}/resources/`), {
      method: "PUT",
      status: 422,
      body: { message: "The resource can't deliver this service." },
    })
    const picker = page.getByRole("combobox", { name: "Resource to associate" })
    await picker.click()
    await page.locator('[data-slot="popover-content"]').last().getByRole("option", { name: ben.name }).click()
    await page.getByRole("button", { name: "Associate resource" }).click()
    await expectToast(page, "The resource can't deliver this service.", { type: "error" })
    await expect(picker).toHaveText(ben.name)
    await expect(resourceNames(page)).toHaveText([roomA.name])
  })

  test("without associations the slots tab points to the Resources tab", async ({ page, api, ui }) => {
    const serviceId = await api.idOf("services", equipment.name)
    const roomAId = await api.idOf("resources", roomA.name)
    await api.delete(`services/${serviceId}/resources/${roomAId}`)
    await gotoService(page, api, equipment.name, "slots")
    const alert = page.getByRole("alert").filter({ hasText: "No resources associated" })
    await expect(alert).toContainText("Associate at least one resource first.")
    await alert.getByRole("button", { name: "Resources", exact: true }).click()
    await expect(resourcesTab(page)).toHaveAttribute("aria-selected", "true")
    await expect(page).toHaveURL(`/services/${serviceId}?tab=resources`)
    await expect(page.getByText("No resources yet")).toBeVisible()
    await expect(page.getByText("Associate at least one resource. Without one, this service has no bookable slots.")).toBeVisible()
    await expect(resourcesTab(page)).toHaveText(/^Resources\s*0$/)

    await ui.tab("Bookable slots")
    // The Resource filter has nothing to offer.
    await page.getByRole("combobox", { name: "Resource" }).click()
    await expect(page.locator('[data-slot="popover-content"]').last().getByText("No resources found.")).toBeVisible()
  })
})
