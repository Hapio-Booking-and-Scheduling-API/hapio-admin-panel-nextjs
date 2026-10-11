import type { BookingIgnoreFlags } from "@/lib/hapio/types"

export type IgnoreFlag = keyof BookingIgnoreFlags | "ignore_cancelation_threshold"

/** Form values every booking form with an "Override rules" section carries. */
export type IgnoreFlagValues = Record<IgnoreFlag, boolean>

export const IGNORE_FLAG_DEFAULTS: IgnoreFlagValues = {
  ignore_schedule: false,
  ignore_fully_booked: false,
  ignore_bookable_slots: false,
  ignore_booking_window: false,
  ignore_cancelation_threshold: false,
}

export const IGNORE_FLAGS: Array<{ key: IgnoreFlag; label: string; description: string; editOnly?: boolean }> = [
  {
    key: "ignore_schedule",
    label: "Ignore schedule",
    description: "Allow times outside the resource's schedule. Also ignores bookable slots.",
  },
  {
    key: "ignore_fully_booked",
    label: "Ignore fully booked",
    description: "Allow the booking even when the resource is already fully booked (overbooking).",
  },
  {
    key: "ignore_bookable_slots",
    label: "Ignore bookable slots",
    description:
      "Allow start and end times that don't match the service's bookable slots, and custom buffer times.",
  },
  {
    key: "ignore_booking_window",
    label: "Ignore booking window",
    description: "Allow times outside the service's booking window (how soon or how far ahead it can be booked).",
  },
  {
    key: "ignore_cancelation_threshold",
    label: "Ignore cancelation threshold",
    description: "Allow canceling after the service's cancelation threshold has passed.",
    editOnly: true,
  },
]

export const CREATE_FLAGS = IGNORE_FLAGS.filter((f) => !f.editOnly)

/** The `ignore_*` flags that are switched on, ready to merge into a request body. */
export function activeIgnoreFlags(values: IgnoreFlagValues, options: { cancelation?: boolean } = {}) {
  const flags: Partial<IgnoreFlagValues> = {}
  for (const { key, editOnly } of IGNORE_FLAGS) {
    if (editOnly && !options.cancelation) continue
    if (values[key]) flags[key] = true
  }
  return flags
}
