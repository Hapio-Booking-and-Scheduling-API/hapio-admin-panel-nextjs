import type { Page } from "@playwright/test"

/**
 * Starts recording whether an element matching `selector` whose text matches `text`
 * ever appears, even for a single frame. Survives client-side navigation.
 * Returns a function that reports whether it appeared.
 */
export async function recordAppearances(page: Page, selector: string, text: string) {
  const key = `__appeared_${Math.random().toString(36).slice(2)}`
  await page.evaluate(
    ({ key, selector, text }) => {
      const w = window as unknown as Record<string, unknown>
      w[key] = false
      const check = () => {
        for (const el of document.querySelectorAll(selector)) {
          if (el.textContent?.includes(text)) w[key] = true
        }
      }
      check()
      new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true, characterData: true })
    },
    { key, selector, text }
  )
  return () => page.evaluate((key) => (window as unknown as Record<string, boolean>)[key], key)
}
