import { describe, expect, it } from "vitest"

import { formatPrice, isValidPriceInput, normalizePrice, PRICE_RE } from "@/lib/format/price"

describe("PRICE_RE", () => {
  it("matches Hapio's price format exactly", () => {
    for (const ok of ["0.000", "149.000", "123456789012.999"]) expect(PRICE_RE.test(ok)).toBe(true)
    for (const bad of ["149", "149.00", "149.0000", "1234567890123.000", "-1.000", " 1.000", "1,000"]) {
      expect(PRICE_RE.test(bad)).toBe(false)
    }
  })
})

describe("normalizePrice", () => {
  it("maps null, undefined, empty and blank input to null", () => {
    expect(normalizePrice(null)).toBeNull()
    expect(normalizePrice(undefined)).toBeNull()
    expect(normalizePrice("")).toBeNull()
    expect(normalizePrice("   ")).toBeNull()
  })

  it("pads to three decimals", () => {
    expect(normalizePrice("149")).toBe("149.000")
    expect(normalizePrice("149.5")).toBe("149.500")
    expect(normalizePrice("149.05")).toBe("149.050")
    expect(normalizePrice("149.")).toBe("149.000")
    expect(normalizePrice("0")).toBe("0.000")
  })

  it("accepts a decimal comma and strips whitespace", () => {
    expect(normalizePrice("12,5")).toBe("12.500")
    expect(normalizePrice(" 1 000,25 ")).toBe("1000.250")
    expect(normalizePrice("1 000")).toBe("1000.000")
  })

  it("keeps leading zeros and up to 12 integer digits", () => {
    expect(normalizePrice("007")).toBe("007.000")
    expect(normalizePrice("123456789012")).toBe("123456789012.000")
  })

  it("rejects anything else", () => {
    for (const bad of ["abc", "1.2345", "-5", "+5", ".5", "1234567890123", "1.2.3", "1,234.5", "1e3", "1,2,3"]) {
      expect(normalizePrice(bad)).toBeUndefined()
    }
  })
})

describe("isValidPriceInput", () => {
  it("is true for empty and normalisable input, false otherwise", () => {
    expect(isValidPriceInput("")).toBe(true)
    expect(isValidPriceInput(null)).toBe(true)
    expect(isValidPriceInput("12,5")).toBe(true)
    expect(isValidPriceInput("abc")).toBe(false)
    expect(isValidPriceInput("1.2345")).toBe(false)
  })
})

describe("formatPrice", () => {
  const local = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })

  it("shows a dash for missing prices", () => {
    expect(formatPrice(null)).toBe("—")
    expect(formatPrice(undefined)).toBe("—")
    expect(formatPrice("")).toBe("—")
  })

  it("shows two decimals, and the third only when it is non-zero", () => {
    expect(formatPrice("149.000")).toBe(local(149))
    expect(formatPrice("149.000")).toMatch(/^149[.,]00$/)
    expect(formatPrice("0.125")).toBe(local(0.125))
    expect(formatPrice("0.125")).toMatch(/^0[.,]125$/)
    expect(formatPrice("450.500")).toMatch(/^450[.,]50$/)
  })

  it("uses the locale's grouping for large prices", () => {
    expect(formatPrice("1234567.000")).toBe(local(1234567))
  })

  it("returns non-numeric input unchanged", () => {
    expect(formatPrice("abc")).toBe("abc")
  })
})
