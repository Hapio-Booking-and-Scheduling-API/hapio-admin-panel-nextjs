import { describe, expect, it } from "vitest"

import { parseAdminConfig } from "@/lib/admin-config"

import { bookingSourceLabel } from "../booking-source-badge"

describe("bookingSourceLabel", () => {
  const config = parseAdminConfig({
    BOOKING_SOURCE_KEY: "source",
    BOOKING_SOURCE_LABELS: '{"mcp":"Booked via AI"}',
  })

  it("labels a known source, and shows an unknown one as it is", () => {
    expect(bookingSourceLabel({ metadata: { source: "mcp" } }, config)).toBe("Booked via AI")
    expect(bookingSourceLabel({ metadata: { source: "phone" } }, config)).toBe("phone")
  })

  it("shows nothing without the key or the setting", () => {
    expect(bookingSourceLabel({ metadata: { name: "Sam" } }, config)).toBeNull()
    expect(bookingSourceLabel({ metadata: null }, config)).toBeNull()
    expect(bookingSourceLabel({ metadata: { source: "mcp" } }, parseAdminConfig({}))).toBeNull()
  })
})
