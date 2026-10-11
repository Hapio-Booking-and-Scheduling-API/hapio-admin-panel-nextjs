import { describe, expect, it } from "vitest"

import { bookingDefaultsFromParams, timestampParam } from "../booking-new-params"

describe("timestampParam", () => {
  it("is undefined when missing or empty", () => {
    expect(timestampParam(null)).toBeUndefined()
    expect(timestampParam("")).toBeUndefined()
  })

  it("restores a + that arrived as a space", () => {
    expect(timestampParam("2026-10-22T09:00:00 02:00")).toBe("2026-10-22T09:00:00+02:00")
    expect(timestampParam("2026-10-22T09:00:00 0200")).toBe("2026-10-22T09:00:00+0200")
    expect(timestampParam("  2026-10-22T09:00:00 02:00  ")).toBe("2026-10-22T09:00:00+02:00")
  })

  it("keeps correctly encoded timestamps", () => {
    expect(timestampParam("2026-10-22T09:00:00+02:00")).toBe("2026-10-22T09:00:00+02:00")
    expect(timestampParam("2026-10-29T10:00:00-04:00")).toBe("2026-10-29T10:00:00-04:00")
    expect(timestampParam("2026-10-22T07:00:00Z")).toBe("2026-10-22T07:00:00Z")
  })

  it("matches how URLSearchParams decodes an unencoded +", () => {
    const raw = new URLSearchParams("starts_at=2026-10-22T09:00:00+02:00").get("starts_at")
    expect(raw).toBe("2026-10-22T09:00:00 02:00")
    expect(timestampParam(raw)).toBe("2026-10-22T09:00:00+02:00")
    const encoded = new URLSearchParams(`starts_at=${encodeURIComponent("2026-10-22T09:00:00+02:00")}`).get("starts_at")
    expect(timestampParam(encoded)).toBe("2026-10-22T09:00:00+02:00")
  })
})

describe("bookingDefaultsFromParams", () => {
  it("is empty without known params", () => {
    expect(bookingDefaultsFromParams(new URLSearchParams())).toEqual({ defaults: {}, prefilled: false })
    expect(bookingDefaultsFromParams(new URLSearchParams("foo=bar&page=2"))).toEqual({ defaults: {}, prefilled: false })
  })

  it("maps every param of the prefill contract", () => {
    const params = new URLSearchParams({
      service: "svc",
      location: "loc",
      resource: "res",
      starts_at: "2026-10-22T09:00:00+02:00",
      ends_at: "2026-10-22T09:45:00+02:00",
      is_temporary: "true",
      booking_group: "grp",
    })
    expect(bookingDefaultsFromParams(params)).toEqual({
      defaults: {
        service_id: "svc",
        location_id: "loc",
        resource_id: "res",
        starts_at: "2026-10-22T09:00:00+02:00",
        ends_at: "2026-10-22T09:45:00+02:00",
        is_temporary: true,
        booking_group_id: "grp",
      },
      prefilled: true,
    })
  })

  it("leaves out missing keys instead of setting them to undefined", () => {
    const { defaults, prefilled } = bookingDefaultsFromParams(new URLSearchParams("service=svc"))
    expect(prefilled).toBe(true)
    expect(defaults).toEqual({ service_id: "svc" })
    expect(Object.keys(defaults)).toEqual(["service_id"])
  })

  it("only accepts is_temporary=true", () => {
    for (const value of ["false", "1", "TRUE", ""]) {
      expect(bookingDefaultsFromParams(new URLSearchParams({ is_temporary: value }))).toEqual({
        defaults: {},
        prefilled: false,
      })
    }
  })

  it("restores unencoded offsets", () => {
    const { defaults } = bookingDefaultsFromParams(
      new URLSearchParams("starts_at=2026-10-22T09:00:00+02:00&ends_at=2026-10-22T09:45:00+02:00")
    )
    expect(defaults).toEqual({ starts_at: "2026-10-22T09:00:00+02:00", ends_at: "2026-10-22T09:45:00+02:00" })
  })

  it("does not derive the end from the start", () => {
    // Filling a missing end from the service's length is the form's job (see BUG-13).
    const { defaults } = bookingDefaultsFromParams(new URLSearchParams("service=svc&starts_at=2026-10-22T09:00:00Z"))
    expect(defaults).toEqual({ service_id: "svc", starts_at: "2026-10-22T09:00:00Z" })
  })
})
