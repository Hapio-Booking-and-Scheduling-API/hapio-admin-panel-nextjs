import { expect, type Locator, type Page } from "@playwright/test"

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** Matches text that starts with `s` (options carry hints after the label). */
export const startsWith = (s: string) => new RegExp(`^${escapeRe(s)}`)
export const exactly = (s: string) => new RegExp(`^${escapeRe(s)}$`)

/** Page-bound helpers for the panel's recurring UI patterns. */
export class Ui {
  constructor(readonly page: Page) {}

  main() {
    return this.page.getByRole("main")
  }

  heading(name: string | RegExp) {
    return this.page.getByRole("heading", { level: 1, name })
  }

  /** Searchable combobox (location/resource/service/time zone pickers). */
  async pick(trigger: Locator, option: string | RegExp, options: { search?: string } = {}) {
    await trigger.click()
    const popover = this.page.locator('[data-slot="popover-content"]').last()
    await expect(popover).toBeVisible()
    const search = options.search ?? (typeof option === "string" ? option : undefined)
    if (search) await popover.locator('[data-slot="command-input"]').fill(search)
    const name = typeof option === "string" ? startsWith(option) : option
    await popover.getByRole("option", { name }).first().click()
    await expect(popover).toBeHidden()
  }

  /** Radix Select: opens the trigger and chooses an option by its visible text. */
  async choose(trigger: Locator, option: string | RegExp) {
    await trigger.click()
    const content = this.page.locator('[data-slot="select-content"]').last()
    await expect(content).toBeVisible()
    await content.getByRole("option", { name: typeof option === "string" ? exactly(option) : option }).click()
    await expect(content).toBeHidden()
  }

  /** A table row containing all of the given texts. */
  row(...texts: (string | RegExp)[]) {
    let row = this.page.getByRole("row")
    for (const text of texts) row = row.filter({ hasText: text })
    return row
  }

  /** Opens a row's actions menu and picks an item. */
  async rowAction(row: Locator, item: string) {
    await row.getByRole("button", { name: /^Actions/ }).click()
    await this.page.getByRole("menuitem", { name: exactly(item) }).click()
  }

  dialog(title: string | RegExp) {
    return this.page.getByRole("dialog", { name: title })
  }

  alertDialog(title: string | RegExp) {
    return this.page.getByRole("alertdialog", { name: title })
  }

  /** Confirms an alert dialog and waits for it to close. */
  async confirm(title: string | RegExp, button: string) {
    const dialog = this.alertDialog(title)
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: exactly(button) }).click()
    await expect(dialog).toBeHidden()
  }

  async dismiss(title: string | RegExp, button = "Cancel") {
    const dialog = this.alertDialog(title)
    await dialog.getByRole("button", { name: exactly(button) }).click()
    await expect(dialog).toBeHidden()
  }

  async tab(name: string | RegExp) {
    const tab = this.page.getByRole("tab", { name })
    await tab.click()
    await expect(tab).toHaveAttribute("aria-selected", "true")
  }

  /** Fills a datetime-local input with wall time "YYYY-MM-DDTHH:mm". */
  async fillDateTime(input: Locator, value: string) {
    await input.fill(value)
  }

  /** The pagination summary, e.g. "1–25 of 32". */
  paginationSummary() {
    return this.main().getByText(/^\d+–\d+ of \d+$|^No results$/)
  }

  /** Waits for a table to show exactly `count` data rows. */
  async expectRowCount(count: number, table: Locator = this.main().getByRole("table").first()) {
    await expect(table.locator("tbody tr")).toHaveCount(count)
  }
}
