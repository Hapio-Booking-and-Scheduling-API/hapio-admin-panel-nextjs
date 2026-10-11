import AxeBuilder from "@axe-core/playwright"
import { expect, type Page } from "@playwright/test"

/** Waits for finite CSS animations and transitions; axe measures colours mid-transition otherwise. */
export async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))
    )
  )
}

/**
 * Fails on serious or critical axe violations (WCAG 2.1 A/AA) in the given scope
 * (default: the whole page).
 */
export async function expectAccessible(
  page: Page,
  options: { include?: string | string[]; disable?: string[] } = {}
) {
  await settleAnimations(page)
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
  for (const selector of [options.include ?? []].flat()) builder = builder.include(selector)
  if (options.disable?.length) builder = builder.disableRules(options.disable)
  const results = await builder.analyze()
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
  expect(
    serious.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })),
    "serious accessibility violations"
  ).toEqual([])
}
