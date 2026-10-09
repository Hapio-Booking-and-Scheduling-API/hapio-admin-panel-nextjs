// Display helpers for services. Other features (e.g. bookings) import
// `serviceTypeLabel` and `summarizeServiceLength` from here.

import { humanizeDuration } from "@/lib/format/duration"
import { formatPrice } from "@/lib/format/price"
import { shortTime } from "@/lib/format/datetime"
import { WEEKDAYS, type DayTime, type Service, type ServiceType, type Weekday } from "@/lib/hapio/types"

export const SERVICE_TYPE_INFO: Record<
  ServiceType,
  { label: string; description: string; priceLabel: string; priceSuffix: string }
> = {
  fixed: {
    label: "Fixed",
    description: "Appointments with a fixed length, like a 45-minute haircut.",
    priceLabel: "Price per booking",
    priceSuffix: "",
  },
  flexible: {
    label: "Flexible",
    description: "The customer picks a length in steps, like renting a court by the half hour.",
    priceLabel: "Hourly rate",
    priceSuffix: "/h",
  },
  day: {
    label: "Day",
    description: "Bookings spanning whole days, like rentals or stays.",
    priceLabel: "Daily rate",
    priceSuffix: "/day",
  },
}

export function serviceTypeLabel(type: ServiceType | string): string {
  return SERVICE_TYPE_INFO[type as ServiceType]?.label ?? type
}

export function pluralDays(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`
}

/**
 * Short summary of a service's booking length:
 * fixed "1 h 30 min", flexible "30 min – 2 h · step 15 min", day "1–7 days".
 */
export function summarizeServiceLength(service: Service): string {
  switch (service.type) {
    case "fixed":
      return humanizeDuration(service.duration)
    case "flexible": {
      const max = service.max_duration ? humanizeDuration(service.max_duration) : "no max"
      return `${humanizeDuration(service.min_duration)} – ${max} · step ${humanizeDuration(service.duration_step)}`
    }
    case "day": {
      if (service.max_days === null) return `${pluralDays(service.min_days)} – no max`
      if (service.max_days === service.min_days) return pluralDays(service.min_days)
      return `${service.min_days}–${service.max_days} days`
    }
  }
}

/** "149.00", "300.00/h", "1,200.00/day" or "—". */
export function servicePriceLabel(service: Pick<Service, "type" | "price">): string {
  if (service.price === null || service.price === undefined) return "—"
  return `${formatPrice(service.price)}${SERVICE_TYPE_INFO[service.type].priceSuffix}`
}

/** One time for every day, or a value per weekday. */
export function isPerWeekday(value: DayTime | undefined | null): value is Record<Weekday, string> {
  return !!value && typeof value === "object"
}

/** Time for a weekday from a DayTime. */
export function dayTimeFor(value: DayTime | undefined | null, day: Weekday): string {
  if (!value) return ""
  return isPerWeekday(value) ? value[day] ?? "" : value
}

/** "09:00" for one time; "Varies by weekday" when per weekday but not all equal. */
export function summarizeDayTime(value: DayTime | undefined | null): string {
  if (!value) return "—"
  if (!isPerWeekday(value)) return shortTime(value)
  const times = WEEKDAYS.map((d) => value[d])
  return times.every((t) => t === times[0]) ? shortTime(times[0]) : "Varies by weekday"
}
