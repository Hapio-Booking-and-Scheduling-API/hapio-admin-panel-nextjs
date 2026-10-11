import { expect, type Page } from "@playwright/test"

/**
 * Asserts a sonner toast with the given text, then closes it so it doesn't cover
 * controls in the bottom-right corner (pagination).
 */
export async function expectToast(
  page: Page,
  text: string | RegExp,
  options: { type?: "success" | "error" | "info" | "warning"; close?: boolean } = {}
) {
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: text }).last()
  await expect(toast).toBeVisible()
  if (options.type) await expect(toast).toHaveAttribute("data-type", options.type)
  if (options.close !== false) {
    const close = toast.getByRole("button", { name: "Close toast" })
    if (await close.isVisible()) await close.click()
  }
  return toast
}

/** Asserts that no toast with this text is showing. */
export async function expectNoToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text })).toHaveCount(0)
}
