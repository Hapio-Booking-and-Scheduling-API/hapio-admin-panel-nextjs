// Hapio prices are decimal strings with exactly three decimals: [0-9]{1,12}\.[0-9]{3}

export const PRICE_RE = /^[0-9]{1,12}\.[0-9]{3}$/

/**
 * Normalise user input to Hapio's price format.
 * "" → null, "149" → "149.000", "12,5" → "12.500". Returns undefined when invalid.
 */
export function normalizePrice(input: string | null | undefined): string | null | undefined {
  if (input === null || input === undefined) return null
  const value = input.trim().replace(/\s/g, "").replace(",", ".")
  if (value === "") return null
  const m = /^(\d{1,12})(?:\.(\d{0,3}))?$/.exec(value)
  if (!m) return undefined
  return `${m[1]}.${(m[2] ?? "").padEnd(3, "0")}`
}

export function isValidPriceInput(input: string | null | undefined): boolean {
  return normalizePrice(input) !== undefined
}

/** "149.000" → "149.00" (shows the third decimal only when it's non-zero). */
export function formatPrice(price: string | null | undefined): string {
  if (price === null || price === undefined || price === "") return "—"
  const n = Number(price)
  if (Number.isNaN(n)) return price
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })
}
