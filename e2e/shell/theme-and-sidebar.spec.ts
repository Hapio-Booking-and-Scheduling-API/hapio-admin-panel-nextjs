import type { Page } from "@playwright/test"

import { SEED } from "../fixtures/seed"
import { expect, test } from "../fixtures/test"
import { navLink, sidebar, tooltip } from "./_helpers"

async function openDashboard(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main").getByText(`Project: ${SEED.project}`)).toBeVisible()
}

async function chooseTheme(page: Page, theme: "Light" | "Dark" | "System") {
  await page.getByRole("button", { name: "Change theme" }).click()
  const menu = page.getByRole("menu")
  await expect(menu).toBeVisible()
  await menu.getByRole("menuitemradio", { name: theme }).click()
  await expect(menu).toBeHidden()
}

async function expectCheckedTheme(page: Page, theme: "Light" | "Dark" | "System") {
  await page.getByRole("button", { name: "Change theme" }).click()
  const menu = page.getByRole("menu")
  for (const option of ["Light", "Dark", "System"]) {
    await expect(menu.getByRole("menuitemradio", { name: option })).toHaveAttribute("aria-checked", String(option === theme))
  }
  await page.keyboard.press("Escape")
  await expect(menu).toBeHidden()
}

const html = (page: Page) => page.locator("html")

/** Waits for the collapse transition (200 ms) to finish: the rail is icon-wide. */
async function expectRail(page: Page) {
  await expect
    .poll(async () => (await sidebar(page).locator('[data-slot="sidebar-container"]').boundingBox())?.width)
    .toBeLessThan(60)
}

test.describe("theme", () => {
  test("defaults to the system theme (light here)", async ({ page }) => {
    await openDashboard(page)
    await expect(html(page)).toHaveClass(/\blight\b/)
    await expect(html(page)).not.toHaveClass(/\bdark\b/)
    await expectCheckedTheme(page, "System")
  })

  test("Dark sets the html class and survives a reload", async ({ page }) => {
    await openDashboard(page)
    await chooseTheme(page, "Dark")
    await expect(html(page)).toHaveClass(/\bdark\b/)
    await expect(html(page)).toHaveCSS("color-scheme", "dark")
    await page.reload()
    await expect(page.getByRole("main").getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(html(page)).toHaveClass(/\bdark\b/)
    await expectCheckedTheme(page, "Dark")
  })

  test("Light overrides a dark system preference and survives a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" })
    await openDashboard(page)
    await expect(html(page)).toHaveClass(/\bdark\b/)
    await chooseTheme(page, "Light")
    await expect(html(page)).toHaveClass(/\blight\b/)
    await expect(html(page)).not.toHaveClass(/\bdark\b/)
    await page.reload()
    await expect(page.getByRole("main").getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(html(page)).toHaveClass(/\blight\b/)
    await expectCheckedTheme(page, "Light")
  })

  test("System follows the OS preference live", async ({ page }) => {
    await openDashboard(page)
    await chooseTheme(page, "Dark")
    await expect(html(page)).toHaveClass(/\bdark\b/)
    await chooseTheme(page, "System")
    await expect(html(page)).toHaveClass(/\blight\b/)
    await page.emulateMedia({ colorScheme: "dark" })
    await expect(html(page)).toHaveClass(/\bdark\b/)
    await page.emulateMedia({ colorScheme: "light" })
    await expect(html(page)).toHaveClass(/\blight\b/)
    await page.reload()
    await expect(page.getByRole("main").getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expectCheckedTheme(page, "System")
  })

  test("the theme is shared across pages", async ({ page, ui }) => {
    await openDashboard(page)
    await chooseTheme(page, "Dark")
    await navLink(page, "Locations").click()
    await expect(ui.main().getByText(SEED.locations.stockholm.name).first()).toBeVisible()
    await expect(html(page)).toHaveClass(/\bdark\b/)
    await page.goto("/project")
    await expect(ui.main().getByText("Project ID")).toBeVisible()
    await expect(html(page)).toHaveClass(/\bdark\b/)
  })
})

test.describe("sidebar", () => {
  const container = (page: Page) => page.locator('[data-slot="sidebar"][data-state]')

  test("\"Toggle Sidebar\" collapses it to an icon rail and back", async ({ page }) => {
    await openDashboard(page)
    await expect(container(page)).toHaveAttribute("data-state", "expanded")
    const width = async () => (await sidebar(page).locator('[data-slot="sidebar-container"]').boundingBox())?.width ?? 0
    expect(await width()).toBeGreaterThan(200)

    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await expect(container(page)).toHaveAttribute("data-collapsible", "icon")
    await expect.poll(width).toBeLessThan(60)
    // Labels hide; the icons stay clickable.
    await expect(sidebar(page).getByText("Hapio API v1")).toBeHidden()
    await expect(navLink(page, "Locations")).toBeVisible()

    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(container(page)).toHaveAttribute("data-state", "expanded")
    await expect(sidebar(page).getByText("Hapio API v1")).toBeVisible()
    await expect.poll(width).toBeGreaterThan(200)
  })

  test("collapsed items show their title as a tooltip and still navigate", async ({ page, ui }) => {
    await openDashboard(page)
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await expectRail(page)
    await navLink(page, "Locations").hover()
    await expect(tooltip(page, "Locations")).toBeVisible()
    await navLink(page, "Locations").click()
    await expect(ui.heading("Locations")).toBeVisible()
    await expect(navLink(page, "Locations")).toHaveAttribute("data-active", "true")
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
  })

  test("collapsed icons are clickable in their centre", async ({ page }) => {
    // The invisible group labels (-mt-8, opacity-0) overlap the last icon of the group above.
    await openDashboard(page)
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await expectRail(page)
    const hits: Record<string, string | null> = {}
    for (const title of ["Dashboard", "Bookings", "Booking groups", "Locations", "Resources", "Services", "Project"]) {
      const box = (await navLink(page, title).boundingBox())!
      hits[title] = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href") ?? null,
        [box.x + box.width / 2, box.y + box.height / 2]
      )
    }
    expect(hits).toEqual({
      Dashboard: "/",
      Bookings: "/bookings",
      "Booking groups": "/booking-groups",
      Locations: "/locations",
      Resources: "/resources",
      Services: "/services",
      Project: "/project",
    })
  })

  test("expanded items don't show tooltips", async ({ page }) => {
    await openDashboard(page)
    await navLink(page, "Resources").hover()
    // The tooltip opens (after its delay) but its content stays hidden while expanded.
    await expect(navLink(page, "Resources")).toHaveAttribute("data-state", "delayed-open")
    await expect(tooltip(page, "Resources")).toBeHidden()
  })

  test("Ctrl+B and Meta+B toggle the sidebar", async ({ page }) => {
    await openDashboard(page)
    await page.keyboard.press("Control+b")
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await page.keyboard.press("Control+b")
    await expect(container(page)).toHaveAttribute("data-state", "expanded")
    await page.keyboard.press("Meta+b")
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await page.keyboard.press("Meta+b")
    await expect(container(page)).toHaveAttribute("data-state", "expanded")
  })

  test("toggling stores the state in the sidebar_state cookie", async ({ page, context }) => {
    await openDashboard(page)
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await expect.poll(async () => (await context.cookies()).find((c) => c.name === "sidebar_state")?.value).toBe("false")
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect.poll(async () => (await context.cookies()).find((c) => c.name === "sidebar_state")?.value).toBe("true")
  })

  test("the collapsed state survives client-side navigation", async ({ page, ui }) => {
    await openDashboard(page)
    await page.keyboard.press("Control+b")
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await navLink(page, "Resources").click()
    await expect(ui.heading("Resources")).toBeVisible()
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
  })

  test("the collapsed state is restored after a reload", async ({ page }) => {
    await openDashboard(page)
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await page.reload()
    await expect(page.getByRole("main").getByText(`Project: ${SEED.project}`)).toBeVisible()
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await expectRail(page)
    // React's state agrees with the restored DOM: one toggle expands it.
    await page.getByRole("button", { name: "Toggle Sidebar" }).click()
    await expect(container(page)).toHaveAttribute("data-state", "expanded")
    await expect(sidebar(page).getByText("Hapio API v1")).toBeVisible()
  })

  test("the saved state is applied from the server HTML, before React hydrates", async ({ page, context, stack }) => {
    await context.addCookies([{ name: "sidebar_state", value: "false", url: stack.appUrl }])
    // Without the app's scripts only the inline script runs: what's painted before hydration.
    await page.route(/\/_next\/static\/.+\.js(\?.*)?$/, (route) => route.abort())
    await page.goto("/")
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await expect(container(page)).toHaveAttribute("data-collapsible", "icon")
    await expectRail(page)
  })

  test("an expanded state cookie keeps the sidebar expanded", async ({ page, context, stack }) => {
    await context.addCookies([{ name: "sidebar_state", value: "true", url: stack.appUrl }])
    await openDashboard(page)
    await expect(container(page)).toHaveAttribute("data-state", "expanded")
    await expect(sidebar(page).getByText("Hapio API v1")).toBeVisible()
  })

  test("a collapsed state cookie applies to any page and across client-side navigation", async ({ page, context, stack, ui }) => {
    await context.addCookies([{ name: "sidebar_state", value: "false", url: stack.appUrl }])
    await page.goto("/locations")
    await expect(ui.main().getByText(SEED.locations.stockholm.name).first()).toBeVisible()
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
    await navLink(page, "Project").click()
    await expect(ui.main().getByText("Project ID")).toBeVisible()
    await expect(container(page)).toHaveAttribute("data-state", "collapsed")
  })
})
