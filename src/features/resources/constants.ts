export const DELETE_RESOURCE_WARNING =
  "This permanently deletes the resource together with its schedule blocks, recurring schedules and their blocks. Its bookings are kept but lose their resource. To keep history intact, consider disabling it instead."

export const RESOURCE_TABS = ["overview", "services", "blocks", "recurring", "availability", "json"] as const
export type ResourceTab = (typeof RESOURCE_TABS)[number]
