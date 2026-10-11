import { afterEach, describe, expect, it, vi } from "vitest"

import {
  browserTimeZone,
  dayRange,
  formatDate,
  formatDateTime,
  formatTime,
  isTimeString,
  normalizeTime,
  shortTime,
  todayIn,
  toHapioDateTime,
  toWallTime,
  wallAt,
  wallDate,
} from "@/lib/format/datetime"

// vitest.config.mts runs tests with TZ=Europe/Stockholm, so the "browser" zone is Stockholm.
// EU DST ends Sun 25 Oct 2026 (03:00 CEST → 02:00 CET); US DST ends Sun 1 Nov 2026.

afterEach(() => {
  vi.useRealTimers()
})

function at(iso: string) {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(iso))
}

describe("browserTimeZone", () => {
  it("returns the resolved zone", () => {
    expect(browserTimeZone()).toBe("Europe/Stockholm")
  })

  it("reports a legacy alias under its current IANA name", () => {
    const resolved = Intl.DateTimeFormat().resolvedOptions()
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ ...resolved, timeZone: "Asia/Calcutta" })
    expect(browserTimeZone()).toBe("Asia/Kolkata")
  })

  it("falls back to UTC when Intl throws", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("no Intl")
    })
    expect(browserTimeZone()).toBe("UTC")
  })
})

describe("toHapioDateTime", () => {
  it.each([
    ["2026-10-21T08:00", "Europe/Stockholm", "2026-10-21T08:00:00+02:00"],
    ["2026-10-26T08:00", "Europe/Stockholm", "2026-10-26T08:00:00+01:00"],
    ["2026-10-21T08:00", "America/New_York", "2026-10-21T08:00:00-04:00"],
    ["2026-11-02T08:00", "America/New_York", "2026-11-02T08:00:00-05:00"],
    ["2026-10-21T08:00", "UTC", "2026-10-21T08:00:00+00:00"],
    ["2026-10-21T08:00", "Pacific/Honolulu", "2026-10-21T08:00:00-10:00"],
    ["2026-10-21T08:00", "Asia/Kolkata", "2026-10-21T08:00:00+05:30"],
    ["2026-10-21T08:00", "Asia/Kathmandu", "2026-10-21T08:00:00+05:45"],
    ["2026-10-21T08:00", "America/St_Johns", "2026-10-21T08:00:00-02:30"],
    ["2026-01-21T08:00", "America/St_Johns", "2026-01-21T08:00:00-03:30"],
  ])("%s in %s → %s", (wall, zone, expected) => {
    expect(toHapioDateTime(wall, zone)).toBe(expected)
  })

  it("keeps seconds, accepts a space separator and date-only input", () => {
    expect(toHapioDateTime("2026-10-21T08:00:15", "UTC")).toBe("2026-10-21T08:00:15+00:00")
    expect(toHapioDateTime("2026-10-21 08:30", "UTC")).toBe("2026-10-21T08:30:00+00:00")
    expect(toHapioDateTime("2026-10-21", "America/New_York")).toBe("2026-10-21T00:00:00-04:00")
  })

  it("uses the browser zone when no zone is given", () => {
    expect(toHapioDateTime("2026-10-21T08:00")).toBe("2026-10-21T08:00:00+02:00")
    expect(toHapioDateTime("2026-10-21T08:00", null)).toBe("2026-10-21T08:00:00+02:00")
    expect(toHapioDateTime("2026-10-21T08:00", "")).toBe("2026-10-21T08:00:00+02:00")
  })

  it("re-interprets the wall part of a timestamp that already has an offset", () => {
    expect(toHapioDateTime("2026-10-21T08:00:00-04:00", "Europe/Stockholm")).toBe("2026-10-21T08:00:00+02:00")
  })

  it("returns input it can't parse unchanged", () => {
    expect(toHapioDateTime("", "UTC")).toBe("")
    expect(toHapioDateTime("not a date", "UTC")).toBe("not a date")
  })

  it("DST gap: a wall time that doesn't exist (29 Mar 02:30 Stockholm) moves forward one hour", () => {
    expect(toHapioDateTime("2026-03-29T02:30", "Europe/Stockholm")).toBe("2026-03-29T03:30:00+02:00")
    expect(toHapioDateTime("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T03:30:00-04:00")
  })

  it("DST overlap: an ambiguous wall time (25 Oct 02:30 Stockholm) resolves to the earlier, summer-time instant", () => {
    expect(toHapioDateTime("2026-10-25T02:30", "Europe/Stockholm")).toBe("2026-10-25T02:30:00+02:00")
    expect(toHapioDateTime("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T01:30:00-04:00")
    // Either side of the overlap is unambiguous.
    expect(toHapioDateTime("2026-10-25T01:59", "Europe/Stockholm")).toBe("2026-10-25T01:59:00+02:00")
    expect(toHapioDateTime("2026-10-25T03:00", "Europe/Stockholm")).toBe("2026-10-25T03:00:00+01:00")
  })
})

describe("toWallTime", () => {
  it("returns empty text for missing input", () => {
    expect(toWallTime(null)).toBe("")
    expect(toWallTime(undefined)).toBe("")
    expect(toWallTime("")).toBe("")
  })

  it("keeps the timestamp's own wall time without a zone", () => {
    expect(toWallTime("2026-10-21T08:00:00-04:00")).toBe("2026-10-21T08:00")
    expect(toWallTime("2026-10-21T23:45:59+05:30")).toBe("2026-10-21T23:45")
    expect(toWallTime("2026-10-21")).toBe("2026-10-21T00:00")
    expect(toWallTime("garbage")).toBe("")
  })

  it("converts to the wall time of a zone", () => {
    expect(toWallTime("2026-10-21T08:00:00-04:00", "Europe/Stockholm")).toBe("2026-10-21T14:00")
    expect(toWallTime("2026-10-21T06:00:00Z", "Asia/Kolkata")).toBe("2026-10-21T11:30")
    expect(toWallTime("2026-10-21T12:00:00+00:00", "America/St_Johns")).toBe("2026-10-21T09:30")
    expect(toWallTime("garbage", "UTC")).toBe("")
  })

  it("round-trips with toHapioDateTime across the EU DST change", () => {
    for (const wall of ["2026-10-24T23:00", "2026-10-25T01:30", "2026-10-25T03:30", "2026-10-26T00:00"]) {
      expect(toWallTime(toHapioDateTime(wall, "Europe/Stockholm"), "Europe/Stockholm")).toBe(wall)
    }
  })
})

describe("wallDate", () => {
  it("builds a local Date from the wall-clock part, ignoring the offset", () => {
    const date = wallDate("2026-10-21T08:30:15-04:00")
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 21])
    expect([date.getHours(), date.getMinutes(), date.getSeconds()]).toEqual([8, 30, 15])
  })

  it("treats a date as midnight", () => {
    expect(wallDate("2026-10-21").getHours()).toBe(0)
  })

  it("falls back to parseISO, which yields an invalid date for garbage", () => {
    expect(Number.isNaN(wallDate("garbage").getTime())).toBe(true)
  })
})

describe("formatDateTime", () => {
  it("shows a dash for missing input", () => {
    expect(formatDateTime(null)).toBe("—")
    expect(formatDateTime(undefined)).toBe("—")
    expect(formatDateTime("")).toBe("—")
  })

  it("shows the timestamp's own wall time by default", () => {
    expect(formatDateTime("2026-10-21T08:00:00-04:00")).toBe("21 Oct 2026, 08:00")
  })

  it("converts to a zone when given one", () => {
    expect(formatDateTime("2026-10-21T08:00:00-04:00", { timeZone: "Europe/Stockholm" })).toBe("21 Oct 2026, 14:00")
  })

  it("appends the offset of the timestamp, using UTC for Z and +00:00", () => {
    expect(formatDateTime("2026-10-21T08:00:00+02:00", { withOffset: true })).toBe("21 Oct 2026, 08:00 (UTC+02:00)")
    expect(formatDateTime("2026-10-21T08:00:00Z", { withOffset: true })).toBe("21 Oct 2026, 08:00 (UTC)")
    expect(formatDateTime("2026-10-21T08:00:00+00:00", { withOffset: true })).toBe("21 Oct 2026, 08:00 (UTC)")
    expect(formatDateTime("2026-10-21T08:00:00+05:30", { withOffset: true })).toBe("21 Oct 2026, 08:00 (UTC+05:30)")
  })

  it("appends the zone's offset at that instant when converting", () => {
    expect(
      formatDateTime("2026-10-26T07:00:00Z", { timeZone: "Europe/Stockholm", withOffset: true })
    ).toBe("26 Oct 2026, 08:00 (UTC+01:00)")
    expect(
      formatDateTime("2026-10-21T12:00:00Z", { timeZone: "America/St_Johns", withOffset: true })
    ).toBe("21 Oct 2026, 09:30 (UTC-02:30)")
  })

  it("adds no suffix when the timestamp has no offset", () => {
    expect(formatDateTime("2026-10-21T08:00:00", { withOffset: true })).toBe("21 Oct 2026, 08:00")
  })

  it("supports a custom pattern and returns unparseable input unchanged", () => {
    expect(formatDateTime("2026-10-21T08:00:00+02:00", { pattern: "EEE d MMM" })).toBe("Wed 21 Oct")
    expect(formatDateTime("garbage")).toBe("garbage")
  })
})

describe("formatTime / formatDate", () => {
  it("formats times, optionally in a zone", () => {
    expect(formatTime("2026-10-21T08:05:00-04:00")).toBe("08:05")
    expect(formatTime("2026-10-21T08:05:00-04:00", "Asia/Kolkata")).toBe("17:35")
    expect(formatTime(null)).toBe("—")
  })

  it("formats dates and timestamps as a date", () => {
    expect(formatDate("2026-10-21")).toBe("21 Oct 2026")
    expect(formatDate("2026-10-21T23:30:00-04:00")).toBe("21 Oct 2026")
    expect(formatDate(null)).toBe("—")
    expect(formatDate("")).toBe("—")
    expect(formatDate("garbage")).toBe("garbage")
  })
})

describe("todayIn", () => {
  it("returns the date in the given zone", () => {
    at("2026-10-21T22:30:00Z") // 00:30 on the 22nd in Stockholm, 18:30 on the 21st in New York
    expect(todayIn("Europe/Stockholm")).toBe("2026-10-22")
    expect(todayIn("America/New_York")).toBe("2026-10-21")
    expect(todayIn("Asia/Kolkata")).toBe("2026-10-22")
  })

  it("uses the browser zone without one", () => {
    at("2026-10-21T22:30:00Z")
    expect(todayIn()).toBe("2026-10-22")
    expect(todayIn(null)).toBe("2026-10-22")
  })

  it("follows the date across the DST change", () => {
    at("2026-10-25T00:30:00Z") // 02:30 CEST, before the clocks go back
    expect(todayIn("Europe/Stockholm")).toBe("2026-10-25")
    at("2026-10-25T23:30:00Z") // 00:30 CET on the 26th
    expect(todayIn("Europe/Stockholm")).toBe("2026-10-26")
  })
})

describe("wallAt", () => {
  it("returns today + n days at the given hour", () => {
    at("2026-10-21T06:00:00Z") // Wed 08:00 Stockholm
    expect(wallAt(0)).toBe("2026-10-21T00:00")
    expect(wallAt(1, 9)).toBe("2026-10-22T09:00")
    expect(wallAt(-1, 17)).toBe("2026-10-20T17:00")
    expect(wallAt(7, 23, "America/New_York")).toBe("2026-10-28T23:00")
  })

  it("uses the zone's date, not the browser's", () => {
    at("2026-10-21T22:30:00Z")
    expect(wallAt(0, 9, "Europe/Stockholm")).toBe("2026-10-22T09:00")
    expect(wallAt(0, 9, "America/New_York")).toBe("2026-10-21T09:00")
  })

  it("adds calendar days across 25 Oct (not 24-hour steps)", () => {
    at("2026-10-24T22:30:00Z") // 00:30 CEST on Sun 25 Oct
    expect(wallAt(0, 0, "Europe/Stockholm")).toBe("2026-10-25T00:00")
    expect(wallAt(1, 0, "Europe/Stockholm")).toBe("2026-10-26T00:00")
    expect(wallAt(2, 0, "Europe/Stockholm")).toBe("2026-10-27T00:00")
  })
})

describe("dayRange", () => {
  it("spans whole days in the zone", () => {
    at("2026-10-21T06:00:00Z")
    expect(dayRange(0, 1, "Europe/Stockholm")).toEqual({
      from: "2026-10-21T00:00:00+02:00",
      to: "2026-10-22T00:00:00+02:00",
    })
  })

  it("carries each end's own offset across the EU change on 25 Oct", () => {
    at("2026-10-24T10:00:00Z") // Sat 24 Oct
    expect(dayRange(0, 2, "Europe/Stockholm")).toEqual({
      from: "2026-10-24T00:00:00+02:00",
      to: "2026-10-26T00:00:00+01:00",
    })
    expect(dayRange(1, 1, "Europe/Stockholm")).toEqual({
      from: "2026-10-25T00:00:00+02:00",
      to: "2026-10-26T00:00:00+01:00",
    })
  })

  it("carries each end's own offset across the US change on 1 Nov", () => {
    at("2026-10-31T12:00:00Z")
    expect(dayRange(0, 2, "America/New_York")).toEqual({
      from: "2026-10-31T00:00:00-04:00",
      to: "2026-11-02T00:00:00-05:00",
    })
  })

  it("uses the browser zone without one", () => {
    at("2026-10-21T06:00:00Z")
    expect(dayRange(0, 7)).toEqual({ from: "2026-10-21T00:00:00+02:00", to: "2026-10-28T00:00:00+01:00" })
  })
})

describe("normalizeTime", () => {
  it.each([
    ["9:00", "09:00:00"],
    ["09:00", "09:00:00"],
    ["09:00:30", "09:00:30"],
    [" 9:05 ", "09:05:00"],
    ["24:00", "24:00:00"],
  ])("%j → %s", (input, output) => {
    expect(normalizeTime(input)).toBe(output)
  })

  it("returns values it can't parse unchanged", () => {
    expect(normalizeTime("9:5")).toBe("9:5")
    expect(normalizeTime("garbage")).toBe("garbage")
    expect(normalizeTime("")).toBe("")
  })
})

describe("shortTime", () => {
  it.each([
    ["09:00:00", "09:00"],
    ["17:30:00", "17:30"],
    ["09:00:30", "09:00:30"],
    ["09:00", "09:00"],
    ["24:00:00", "24:00"],
  ])("%s → %s", (input, output) => {
    expect(shortTime(input)).toBe(output)
  })

  it("returns empty text for missing input and unknown formats unchanged", () => {
    expect(shortTime(null)).toBe("")
    expect(shortTime(undefined)).toBe("")
    expect(shortTime("")).toBe("")
    expect(shortTime("9:00")).toBe("9:00")
  })
})

describe("isTimeString", () => {
  it("accepts hh:mm:ss from 00:00:00 to 23:59:59", () => {
    for (const ok of ["00:00:00", "09:00:00", "23:59:59"]) expect(isTimeString(ok)).toBe(true)
    for (const bad of ["24:00:00", "9:00:00", "09:00", "12:60:00", "12:00:60", "ab:cd:ef", ""]) {
      expect(isTimeString(bad)).toBe(false)
    }
  })

  it("accepts exactly 24:00:00 with allow24", () => {
    expect(isTimeString("24:00:00", true)).toBe(true)
    expect(isTimeString("24:00:01", true)).toBe(false)
    expect(isTimeString("24:00", true)).toBe(false)
    expect(isTimeString("09:00:00", true)).toBe(true)
  })
})

describe("timeZones", () => {
  async function fresh() {
    vi.resetModules()
    return (await import("@/lib/format/datetime")).timeZones
  }

  it("lists the runtime's zones with UTC first when the runtime omits it, and caches the list", async () => {
    const timeZones = await fresh()
    const zones = timeZones()
    expect(zones).toContain("UTC")
    expect(zones).toContain("Europe/Stockholm")
    expect(zones).toContain("America/New_York")
    expect(zones).toContain("America/St_Johns")
    expect(zones.length).toBeGreaterThan(100)
    expect(new Set(zones).size).toBe(zones.length)
    expect(timeZones()).toBe(zones)
  })

  it("offers the current IANA names (Asia/Kolkata, Europe/Kyiv), not the legacy aliases", async () => {
    // V8/ICU (Node and Chromium) list CLDR's legacy ids: Asia/Calcutta, Europe/Kiev, Asia/Saigon,
    // Asia/Katmandu. The picker must find "Kolkata" or "Kyiv", which is what Hapio stores.
    const zones = (await fresh())()
    expect(zones).toEqual(expect.arrayContaining(["Asia/Kolkata", "Europe/Kyiv", "Asia/Ho_Chi_Minh", "Asia/Kathmandu"]))
    expect(zones).not.toContain("Asia/Calcutta")
    expect(zones).not.toContain("Europe/Kiev")
    // Still alphabetical (apart from a prepended UTC), so Kolkata sits next to Kathmandu.
    const named = zones.filter((z) => z !== "UTC")
    expect([...named].sort()).toEqual(named)
  })

  it("maps legacy aliases and drops the duplicates when the runtime lists both names", async () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Europe/Kyiv", "Asia/Calcutta", "Europe/Kiev", "UTC"])
    const timeZones = await fresh()
    expect(timeZones()).toEqual(["Asia/Kolkata", "Europe/Kyiv", "UTC"])
  })

  it("prepends UTC when the supported list lacks it", async () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Europe/Stockholm"])
    const timeZones = await fresh()
    expect(timeZones()).toEqual(["UTC", "Europe/Stockholm"])
  })

  it("keeps a list that already includes UTC as is", async () => {
    vi.spyOn(Intl, "supportedValuesOf").mockReturnValue(["Europe/Stockholm", "UTC"])
    const timeZones = await fresh()
    expect(timeZones()).toEqual(["Europe/Stockholm", "UTC"])
  })

  it("falls back to [UTC] when the list is empty or Intl throws", async () => {
    const spy = vi.spyOn(Intl, "supportedValuesOf").mockReturnValue([])
    expect((await fresh())()).toEqual(["UTC"])
    spy.mockImplementation(() => {
      throw new RangeError("unsupported")
    })
    expect((await fresh())()).toEqual(["UTC"])
  })

  it("does not re-query Intl once cached", async () => {
    const timeZones = await fresh()
    timeZones()
    const spy = vi.spyOn(Intl, "supportedValuesOf")
    timeZones()
    expect(spy).not.toHaveBeenCalled()
  })
})
