"use client"

import { hapio } from "@/lib/hapio/client"
import { useHapioMutation } from "@/lib/hapio/hooks"
import type { Uuid } from "@/lib/hapio/types"

/**
 * State transitions for a single booking. Hapio has no dedicated endpoints:
 * each one is a PATCH of the matching field.
 */
export function useBookingActions() {
  const finalize = useHapioMutation((id: Uuid) => hapio.bookings.patch(id, { is_temporary: false }), {
    success: "Booking finalized",
  })

  const cancel = useHapioMutation(
    ({ id, ignoreThreshold }: { id: Uuid; ignoreThreshold?: boolean }) =>
      hapio.bookings.patch(id, {
        is_canceled: true,
        ...(ignoreThreshold ? { ignore_cancelation_threshold: true } : {}),
      }),
    { success: "Booking canceled" }
  )

  const restore = useHapioMutation((id: Uuid) => hapio.bookings.patch(id, { is_canceled: false }), {
    success: "Booking restored",
  })

  const setGroup = useHapioMutation(
    ({ id, groupId }: { id: Uuid; groupId: Uuid | null }) => hapio.bookings.patch(id, { booking_group_id: groupId }),
    { success: (_, vars) => (vars.groupId ? "Booking moved to group" : "Booking removed from group") }
  )

  const remove = useHapioMutation((id: Uuid) => hapio.bookings.delete(id), { success: "Booking deleted" })

  return { finalize, cancel, restore, setGroup, remove }
}
