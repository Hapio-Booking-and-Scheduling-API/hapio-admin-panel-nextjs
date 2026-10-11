import { describe, expect, it } from "vitest"

import { formatPrice } from "@/lib/format/price"
import { WEEKDAYS, type ServiceDay, type ServiceFixed, type ServiceFlexible, type Weekday } from "@/lib/hapio/types"

import {
  SERVICE_TYPE_INFO,
  dayTimeFor,
  isPerWeekday,
  pluralDays,
  servicePriceLabel,
  serviceTypeLabel,
  summarizeDayTime,
  summarizeServiceLength,
} from "../utils"

const common = {
  price: null,
  buffer_time_before: "PT0S",
  buffer_time_after: "PT0S",
  booking_window_start: "PT0S",
  booking_window_end: null,
  cancelation_threshold: "PT0S",
  metadata: null,
  enabled: true,
  created_at: "2026-09-01T10:00:00+00:00",
  updated_at: "2026-09-01T10:00:00+00:00",
}
const fixed: ServiceFixed = { id: "f", name: "Haircut", type: "fixed", duration: "PT45M", bookable_interval: null, ...common }
const flexible: ServiceFlexible = {
  id: "x",
  name: "Studio rental",
  type: "flexible",
  min_duration: "PT1H",
  max_duration: "PT4H",
  default_duration: null,
  duration_step: "PT30M",
  bookable_interval: null,
  ...common,
}
const day: ServiceDay = {
  id: "d",
  name: "Equipment rental",
  type: "day",
  start_time: "09:00:00",
  end_time: "17:00:00",
  min_days: 1,
  max_days: 7,
  default_days: null,
  ...common,
}
const week = (time: string, overrides: Record<string, string> = {}) =>
  Object.fromEntries(WEEKDAYS.map((d) => [d, overrides[d] ?? time])) as Record<(typeof WEEKDAYS)[number], string>

describe("SERVICE_TYPE_INFO and serviceTypeLabel", () => {
  it("describes every type", () => {
    expect(SERVICE_TYPE_INFO.fixed).toMatchObject({ label: "Fixed", priceLabel: "Price per booking", priceSuffix: "" })
    expect(SERVICE_TYPE_INFO.flexible).toMatchObject({ label: "Flexible", priceLabel: "Hourly rate", priceSuffix: "/h" })
    expect(SERVICE_TYPE_INFO.day).toMatchObject({ label: "Day", priceLabel: "Daily rate", priceSuffix: "/day" })
    for (const info of Object.values(SERVICE_TYPE_INFO)) expect(info.description).toMatch(/\.$/)
  })

  it("labels known types and passes unknown ones through", () => {
    expect(serviceTypeLabel("fixed")).toBe("Fixed")
    expect(serviceTypeLabel("flexible")).toBe("Flexible")
    expect(serviceTypeLabel("day")).toBe("Day")
    expect(serviceTypeLabel("hourly")).toBe("hourly")
  })
})

describe("pluralDays", () => {
  it("pluralizes", () => {
    expect(pluralDays(1)).toBe("1 day")
    expect(pluralDays(2)).toBe("2 days")
    expect(pluralDays(0)).toBe("0 days")
  })
})

describe("summarizeServiceLength", () => {
  it("summarizes a fixed service", () => {
    expect(summarizeServiceLength(fixed)).toBe("45 min")
    expect(summarizeServiceLength({ ...fixed, duration: "PT1H30M" })).toBe("1 h 30 min")
  })

  it("summarizes a flexible service", () => {
    expect(summarizeServiceLength(flexible)).toBe("1 h – 4 h · step 30 min")
    expect(summarizeServiceLength({ ...flexible, max_duration: null })).toBe("1 h – no max · step 30 min")
  })

  it("summarizes a day service", () => {
    expect(summarizeServiceLength(day)).toBe("1–7 days")
    expect(summarizeServiceLength({ ...day, min_days: 3, max_days: 3 })).toBe("3 days")
    expect(summarizeServiceLength({ ...day, min_days: 1, max_days: 1 })).toBe("1 day")
    expect(summarizeServiceLength({ ...day, max_days: null })).toBe("1 day – no max")
    expect(summarizeServiceLength({ ...day, min_days: 2, max_days: null })).toBe("2 days – no max")
  })
})

describe("servicePriceLabel", () => {
  it("shows a dash without a price", () => {
    expect(servicePriceLabel(fixed)).toBe("—")
    expect(servicePriceLabel({ type: "day", price: undefined as unknown as null })).toBe("—")
  })

  it("adds the per-type suffix", () => {
    expect(servicePriceLabel({ ...fixed, price: "450.000" })).toBe(formatPrice("450.000"))
    expect(servicePriceLabel({ ...flexible, price: "300.000" })).toBe(`${formatPrice("300.000")}/h`)
    expect(servicePriceLabel({ ...day, price: "1200.500" })).toBe(`${formatPrice("1200.500")}/day`)
  })

  it("keeps a zero price", () => {
    expect(servicePriceLabel({ ...fixed, price: "0.000" })).toBe(formatPrice("0.000"))
  })
})

describe("isPerWeekday", () => {
  it("is true only for a weekday record", () => {
    expect(isPerWeekday(week("09:00:00"))).toBe(true)
    expect(isPerWeekday("09:00:00")).toBe(false)
    expect(isPerWeekday("")).toBe(false)
    expect(isPerWeekday(null)).toBe(false)
    expect(isPerWeekday(undefined)).toBe(false)
  })
})

describe("dayTimeFor", () => {
  it("reads one time or a weekday's time", () => {
    expect(dayTimeFor("09:00:00", "sunday")).toBe("09:00:00")
    expect(dayTimeFor(week("09:00:00", { friday: "10:00:00" }), "friday")).toBe("10:00:00")
    expect(dayTimeFor(week("09:00:00", { friday: "10:00:00" }), "monday")).toBe("09:00:00")
  })

  it("returns an empty string when missing", () => {
    expect(dayTimeFor(null, "monday")).toBe("")
    expect(dayTimeFor(undefined, "monday")).toBe("")
    expect(dayTimeFor({ monday: "09:00:00" } as unknown as Record<Weekday, string>, "tuesday")).toBe("")
  })
})

describe("summarizeDayTime", () => {
  it("shortens one time", () => {
    expect(summarizeDayTime("09:00:00")).toBe("09:00")
    expect(summarizeDayTime("09:30:15")).toBe("09:30:15")
  })

  it("summarizes weekday records", () => {
    expect(summarizeDayTime(week("08:00:00"))).toBe("08:00")
    expect(summarizeDayTime(week("08:00:00", { saturday: "10:00:00" }))).toBe("Varies by weekday")
  })

  it("shows a dash when missing", () => {
    expect(summarizeDayTime(null)).toBe("—")
    expect(summarizeDayTime(undefined)).toBe("—")
    expect(summarizeDayTime("")).toBe("—")
  })
})
