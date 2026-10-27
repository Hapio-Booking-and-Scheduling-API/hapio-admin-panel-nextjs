import { describe, expect, it } from "vitest"

import { can, isShown, parseAdminConfig } from "@/lib/admin-config"
import { sectionOf } from "@/proxy"

describe("parseAdminConfig", () => {
  it("turns everything off by default", () => {
    expect(parseAdminConfig({})).toEqual({
      banner: null,
      bookingSource: null,
      bookingCreateMetadata: {},
      readonly: [],
      hidden: [],
      refetchInterval: false,
    })
  })

  it("reads every setting", () => {
    const config = parseAdminConfig({
      ADMIN_BANNER_TEXT: " Demo project ",
      ADMIN_BANNER_LINK: "https://hapio.app/register",
      ADMIN_BANNER_LINK_TEXT: "Start your own",
      BOOKING_SOURCE_KEY: "source",
      BOOKING_SOURCE_LABELS: '{"mcp":"Booked via AI"}',
      BOOKING_CREATE_METADATA: '{"source":"admin"}',
      ADMIN_READONLY: "Locations, schedules,bookings:delete",
      ADMIN_HIDDEN: "booking-groups",
      ADMIN_REFETCH_INTERVAL: "10000",
    })

    expect(config).toEqual({
      banner: { text: "Demo project", link: "https://hapio.app/register", linkText: "Start your own" },
      bookingSource: { key: "source", labels: { mcp: "Booked via AI" } },
      bookingCreateMetadata: { source: "admin" },
      readonly: ["locations", "schedules", "bookings:delete"],
      hidden: ["booking-groups"],
      refetchInterval: 10_000,
    })
  })

  it("ignores JSON that isn't an object, and refetches no faster than every 5 seconds", () => {
    const config = parseAdminConfig({
      BOOKING_SOURCE_KEY: "source",
      BOOKING_SOURCE_LABELS: "not json",
      BOOKING_CREATE_METADATA: "[1, 2]",
      ADMIN_REFETCH_INTERVAL: "100",
    })

    expect(config.bookingSource).toEqual({ key: "source", labels: {} })
    expect(config.bookingCreateMetadata).toEqual({})
    expect(config.refetchInterval).toBe(5000)
    expect(parseAdminConfig({ ADMIN_REFETCH_INTERVAL: "soon" }).refetchInterval).toBe(false)
  })
})

describe("can", () => {
  const config = parseAdminConfig({ ADMIN_READONLY: "locations,bookings:delete" })

  it("blocks every action on a read-only entity, or only the listed one", () => {
    expect(can("locations", "create", config)).toBe(false)
    expect(can("locations", "update", config)).toBe(false)
    expect(can("bookings", "delete", config)).toBe(false)
    expect(can("bookings", "update", config)).toBe(true)
    expect(can("services", "delete", config)).toBe(true)
  })
})

describe("hidden sections", () => {
  it("finds the section of a path", () => {
    expect(sectionOf("/")).toBe("dashboard")
    expect(sectionOf("/booking-groups")).toBe("booking-groups")
    expect(sectionOf("/booking-groups/new")).toBe("booking-groups")
  })

  it("hides only the listed sections", () => {
    const config = parseAdminConfig({ ADMIN_HIDDEN: "booking-groups" })
    expect(isShown("booking-groups", config)).toBe(false)
    expect(isShown("bookings", config)).toBe(true)
  })
})
