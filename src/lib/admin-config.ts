// Optional settings for running the panel somewhere else than on your own
// machine: behind a gateway, embedded in another site, or with a token that
// can't do everything. All are off by default.
//
// NEXT_PUBLIC_ variables are inlined at build time, so each must be read as a
// literal process.env.NEXT_PUBLIC_… below.

/** The entities that can be made read-only, and the actions on them. */
export const ENTITIES = [
  "locations",
  "resources",
  "services",
  "schedules",
  "bookings",
  "booking-groups",
] as const
export type Entity = (typeof ENTITIES)[number]
export type Action = "create" | "update" | "delete"

/** The sections that can be hidden from the sidebar and the routes. */
export type Section = "dashboard" | "calendar" | "bookings" | "booking-groups" | "locations" | "resources" | "services" | "project"

export interface AdminConfig {
  banner: { text: string; link?: string; linkText?: string } | null
  bookingSource: { key: string; labels: Record<string, string> } | null
  bookingCreateMetadata: Record<string, unknown>
  /** Entities, or entity:action, that can't be changed. */
  readonly: string[]
  hidden: string[]
  refetchInterval: number | false
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function jsonObject(value: string | undefined, name: string): Record<string, unknown> {
  if (!value?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // Reported below
  }
  console.warn(`${name} must be a JSON object; it's ignored.`)
  return {}
}

/** Reads the settings from environment variables, by their names without NEXT_PUBLIC_. */
export function parseAdminConfig(env: Record<string, string | undefined>): AdminConfig {
  const bannerText = env.ADMIN_BANNER_TEXT?.trim()
  const sourceKey = env.BOOKING_SOURCE_KEY?.trim()
  const interval = Number(env.ADMIN_REFETCH_INTERVAL)

  return {
    banner: bannerText
      ? {
          text: bannerText,
          link: env.ADMIN_BANNER_LINK?.trim() || undefined,
          linkText: env.ADMIN_BANNER_LINK_TEXT?.trim() || undefined,
        }
      : null,
    bookingSource: sourceKey
      ? {
          key: sourceKey,
          labels: Object.fromEntries(
            Object.entries(jsonObject(env.BOOKING_SOURCE_LABELS, "NEXT_PUBLIC_BOOKING_SOURCE_LABELS")).map(
              ([value, label]) => [value, String(label)]
            )
          ),
        }
      : null,
    bookingCreateMetadata: jsonObject(env.BOOKING_CREATE_METADATA, "NEXT_PUBLIC_BOOKING_CREATE_METADATA"),
    readonly: list(env.ADMIN_READONLY),
    hidden: list(env.ADMIN_HIDDEN),
    // At least five seconds, so a typo can't flood the rate limit
    refetchInterval: Number.isFinite(interval) && interval > 0 ? Math.max(interval, 5000) : false,
  }
}

export const adminConfig: AdminConfig = parseAdminConfig({
  ADMIN_BANNER_TEXT: process.env.NEXT_PUBLIC_ADMIN_BANNER_TEXT,
  ADMIN_BANNER_LINK: process.env.NEXT_PUBLIC_ADMIN_BANNER_LINK,
  ADMIN_BANNER_LINK_TEXT: process.env.NEXT_PUBLIC_ADMIN_BANNER_LINK_TEXT,
  BOOKING_SOURCE_KEY: process.env.NEXT_PUBLIC_BOOKING_SOURCE_KEY,
  BOOKING_SOURCE_LABELS: process.env.NEXT_PUBLIC_BOOKING_SOURCE_LABELS,
  BOOKING_CREATE_METADATA: process.env.NEXT_PUBLIC_BOOKING_CREATE_METADATA,
  ADMIN_READONLY: process.env.NEXT_PUBLIC_ADMIN_READONLY,
  ADMIN_HIDDEN: process.env.NEXT_PUBLIC_ADMIN_HIDDEN,
  ADMIN_REFETCH_INTERVAL: process.env.NEXT_PUBLIC_ADMIN_REFETCH_INTERVAL,
})

/**
 * Whether an action on an entity is allowed. "locations" in the read-only
 * list blocks every change to locations; "bookings:delete" only deleting.
 */
export function can(entity: Entity, action: Action, config: AdminConfig = adminConfig): boolean {
  return !config.readonly.includes(entity) && !config.readonly.includes(`${entity}:${action}`)
}

/** Whether a section is shown. */
export function isShown(section: Section, config: AdminConfig = adminConfig): boolean {
  return !config.hidden.includes(section)
}
