import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { breadcrumbs, navLink, sidebar } from "./_helpers"

const NAV = [
  { title: "Dashboard", href: "/", heading: "Dashboard", proof: `Project: ${SEED.project}` },
  { title: "Bookings", href: "/bookings", heading: "Bookings", proof: "Studio rental" },
  { title: "Booking groups", href: "/booking-groups", heading: "Booking groups", proof: "2 confirmed" },
  { title: "Locations", href: "/locations", heading: "Locations", proof: SEED.locations.newYork.name },
  { title: "Resources", href: "/resources", heading: "Resources", proof: SEED.resources.roomA.name },
  { title: "Services", href: "/services", heading: "Services", proof: SEED.services.equipment.name },
  { title: "Project", href: "/project", heading: "Project", proof: SEED.project },
] as const

const TITLES = NAV.map((n) => n.title)

async function expectOnlyActive(page: import("@playwright/test").Page, active: string) {
  for (const title of TITLES) {
    await expect(navLink(page, title)).toHaveAttribute("data-active", String(title === active))
  }
}

test.describe("sidebar navigation", () => {
  test("shows the app and project name", async ({ page }) => {
    await page.goto("/")
    await expect(sidebar(page).getByText(SEED.project)).toBeVisible()
    await expect(sidebar(page).getByText("Hapio Admin")).toBeVisible()
    await expect(sidebar(page).getByText("Hapio API v1")).toBeVisible()
    for (const title of TITLES) await expect(navLink(page, title)).toBeVisible()
  })

  for (const target of NAV) {
    test(`"${target.title}" navigates to ${target.href} and is marked active`, async ({ page, ui }) => {
      // Start somewhere else so the click really navigates.
      const start = target.href === "/project" ? "/" : "/project"
      await page.goto(start)
      await expect(ui.main().getByText(start === "/" ? `Project: ${SEED.project}` : "Project ID")).toBeVisible()
      await navLink(page, target.title).click()
      await expect(page).toHaveURL((url) => url.pathname === target.href)
      await expect(ui.heading(target.heading)).toBeVisible()
      await expect(ui.main().getByText(target.proof).first()).toBeVisible()
      await expectOnlyActive(page, target.title)
    })
  }

  test("detail and new pages keep their section active", async ({ page, api, ui }) => {
    const anna = await api.idOf("resources", SEED.resources.anna.name)
    await page.goto(`/resources/${anna}`)
    await expect(ui.heading(SEED.resources.anna.name)).toBeVisible()
    await expectOnlyActive(page, "Resources")

    await page.goto("/bookings/new")
    await expect(ui.heading("New booking")).toBeVisible()
    await expectOnlyActive(page, "Bookings")

    // "/booking-groups" must not light up "/bookings" (prefix match on a segment boundary).
    await page.goto("/booking-groups/new")
    await expect(ui.heading("New booking group")).toBeVisible()
    await expectOnlyActive(page, "Booking groups")
  })

  test("the logo link goes to the dashboard", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(ui.main().getByText(SEED.locations.stockholm.name).first()).toBeVisible()
    await sidebar(page).getByRole("link", { name: /Hapio Admin/ }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
  })
})

test.describe("breadcrumbs", () => {
  test("the dashboard shows a single current crumb", async ({ page, ui }) => {
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    const crumbs = breadcrumbs(page).getByRole("listitem")
    await expect(crumbs).toHaveCount(1)
    await expect(crumbs.first()).toHaveText("Dashboard")
    await expect(breadcrumbs(page).getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page")
  })

  test("section pages drop the root crumb", async ({ page, ui }) => {
    await page.goto("/locations")
    await expect(ui.main().getByText(SEED.locations.stockholm.name).first()).toBeVisible()
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Locations"])
    await expect(breadcrumbs(page).getByRole("link", { name: "Locations" })).toHaveAttribute("aria-current", "page")
  })

  test("new pages show a \"New\" segment with a working parent link", async ({ page, ui }) => {
    await page.goto("/bookings/new")
    await expect(ui.heading("New booking")).toBeVisible()
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Bookings", "New"])
    await breadcrumbs(page).getByRole("link", { name: "Bookings" }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/bookings")
    await expect(ui.heading("Bookings")).toBeVisible()
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Bookings"])

    await page.goto("/booking-groups/new")
    await expect(ui.heading("New booking group")).toBeVisible()
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Booking groups", "New"])
  })

  test("a detail page shows the UUID prefix until the entity loads, then its name", async ({ page, api, net, ui }) => {
    const location = await api.byName("locations", SEED.locations.stockholm.name)
    await net.delay(`locations/${location.id}`, 1_000)
    await page.goto(`/locations/${location.id}`)
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Locations", `${location.id.slice(0, 8)}…`])
    await expect(ui.heading(SEED.locations.stockholm.name)).toBeVisible()
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Locations", SEED.locations.stockholm.name])
    await breadcrumbs(page).getByRole("link", { name: "Locations" }).click()
    await expect(page).toHaveURL((url) => url.pathname === "/locations")
    await expect(ui.heading("Locations")).toBeVisible()
  })

  test("each detail page labels its crumb with the entity", async ({ page, api, ui }) => {
    const resource = await api.byName("resources", SEED.resources.roomA.name)
    await page.goto(`/resources/${resource.id}`)
    await expect(ui.heading(SEED.resources.roomA.name)).toBeVisible()
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Resources", SEED.resources.roomA.name])

    const service = await api.byName("services", SEED.services.studio.name)
    await page.goto(`/services/${service.id}`)
    await expect(ui.heading(SEED.services.studio.name)).toBeVisible()
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Services", SEED.services.studio.name])

    const booking = await api.bookingFor("Erik Lund")
    await page.goto(`/bookings/${booking.id}`)
    await expect(ui.heading("Haircut")).toBeVisible()
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Bookings", "Haircut · 22 Oct, 09:00"])

    const [group] = await api.list<{ id: string }>("booking-groups")
    await page.goto(`/booking-groups/${group.id}`)
    await expect(ui.heading(/^Booking group/)).toBeVisible()
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Booking groups", `Group ${group.id.slice(0, 8)}`])
  })

  test("a renamed entity updates its crumb after a refetch", async ({ page, api, ui }) => {
    const location = await api.byName("locations", SEED.locations.newYork.name)
    await page.goto(`/locations/${location.id}`)
    await expect(ui.heading(SEED.locations.newYork.name)).toBeVisible()
    await ui.main().getByRole("button", { name: "Edit" }).click()
    const dialog = ui.dialog("Edit location")
    await dialog.getByRole("textbox", { name: "Name" }).fill("Brooklyn Loft")
    await dialog.getByRole("button", { name: "Save changes" }).click()
    await expect(dialog).toBeHidden()
    await expect(ui.heading("Brooklyn Loft")).toBeVisible()
    await expect(breadcrumbs(page).getByRole("listitem")).toHaveText(["Locations", "Brooklyn Loft"])
  })
})

test.describe("document titles", () => {
  for (const [path, title] of [
    ["/", "Hapio Admin"],
    ["/bookings", "Bookings · Hapio Admin"],
    ["/bookings/new", "New booking · Hapio Admin"],
    ["/booking-groups", "Booking groups · Hapio Admin"],
    ["/booking-groups/new", "New booking group · Hapio Admin"],
    ["/locations", "Locations · Hapio Admin"],
    ["/resources", "Resources · Hapio Admin"],
    ["/services", "Services · Hapio Admin"],
    ["/project", "Project · Hapio Admin"],
  ] as const) {
    test(`${path} → "${title}"`, async ({ page }) => {
      await page.goto(path)
      // The sidebar's project name comes from the API on every page.
      await expect(sidebar(page).getByText(SEED.project)).toBeVisible()
      await expect(page).toHaveTitle(title)
    })
  }

  test("detail pages are titled by entity type", async ({ page, api, ui }) => {
    const cases = [
      [`/locations/${await api.idOf("locations", SEED.locations.stockholm.name)}`, SEED.locations.stockholm.name, "Location · Hapio Admin"],
      [`/resources/${await api.idOf("resources", SEED.resources.ben.name)}`, SEED.resources.ben.name, "Resource · Hapio Admin"],
      [`/services/${await api.idOf("services", SEED.services.haircut.name)}`, SEED.services.haircut.name, "Service · Hapio Admin"],
      [`/bookings/${(await api.bookingFor("Nora Falk")).id}`, "Haircut", "Booking · Hapio Admin"],
      [`/booking-groups/${(await api.list<{ id: string }>("booking-groups"))[0].id}`, /^Booking group/, "Booking group · Hapio Admin"],
    ] as const
    for (const [path, heading, title] of cases) {
      await page.goto(path)
      await expect(ui.heading(heading)).toBeVisible()
      await expect(page).toHaveTitle(title)
    }
  })

  test("the title follows client-side navigation", async ({ page, ui }) => {
    await page.goto("/")
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    await navLink(page, "Services").click()
    await expect(ui.heading("Services")).toBeVisible()
    await expect(page).toHaveTitle("Services · Hapio Admin")
    await navLink(page, "Dashboard").click()
    await expect(ui.main().getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(page).toHaveTitle("Hapio Admin")
  })
})

test.describe("not found", () => {
  test("an unknown route shows the 404 page", async ({ page }) => {
    const response = await page.goto("/no-such-page")
    expect(response?.status()).toBe(404)
    await expect(page.getByText("This page could not be found.")).toBeVisible()
  })

  test("an unknown nested route shows the 404 page", async ({ page }) => {
    const response = await page.goto("/locations/00000000-0000-4000-8000-000000000000/extra")
    expect(response?.status()).toBe(404)
    await expect(page.getByText("This page could not be found.")).toBeVisible()
  })

  const UNKNOWN = "00000000-0000-4000-8000-000000000000"
  for (const [section, collection] of [
    ["locations", "locations"],
    ["resources", "resources"],
    ["services", "services"],
    ["bookings", "bookings"],
    ["booking-groups", "booking-groups"],
  ] as const) {
    test(`/${section}/<unknown uuid> shows a 404 error with Retry`, async ({ page, net, ui }) => {
      await page.goto(`/${section}/${UNKNOWN}`)
      const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (404)" })
      await expect(alert).toBeVisible()
      await expect(alert).toContainText(/Not found\./)
      // 404s aren't retried automatically.
      expect(net.find("GET", `${collection}/${UNKNOWN}`)).toHaveLength(1)
      // The breadcrumb keeps the UUID prefix: there's no name to show.
      await expect(breadcrumbs(page).getByRole("listitem").last()).toHaveText("00000000…")

      const refetch = net.waitFor("GET", `${collection}/${UNKNOWN}`)
      await alert.getByRole("button", { name: "Retry" }).click()
      await refetch
      await expect(alert).toBeVisible()
      await expect.poll(() => net.find("GET", `${collection}/${UNKNOWN}`).length).toBe(2)
    })
  }

  test("Retry recovers once the entity can be loaded", async ({ page, api, net, ui }) => {
    const service = await api.byName("services", SEED.services.haircut.name)
    await net.fail(`services/${service.id}`, { method: "GET", status: 404, body: { message: "Not found." }, times: 1 })
    await page.goto(`/services/${service.id}`)
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (404)" })
    await expect(alert).toBeVisible()
    await alert.getByRole("button", { name: "Retry" }).click()
    await expect(ui.heading(SEED.services.haircut.name)).toBeVisible()
    await expect(alert).toBeHidden()
  })

  test("a 404 explains that the entity may have been deleted", async ({ page, ui }) => {
    await page.goto("/locations/00000000-0000-4000-8000-000000000000")
    const alert = ui.main().getByRole("alert").filter({ hasText: "Request failed (404)" })
    await expect(alert).toBeVisible()
    await expect(alert).toContainText("Not found. It may have been deleted.")
  })
})
