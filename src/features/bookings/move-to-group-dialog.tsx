"use client"

import { useId, useState } from "react"

import { FormDialog } from "@/components/form/form-dialog"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { hapio } from "@/lib/hapio/client"
import { useHapioMutation } from "@/lib/hapio/hooks"
import type { Booking } from "@/lib/hapio/types"

import { BookingGroupIdInput } from "./group-id-input"
import { UUID_RE } from "./utils"

/** Adds a booking to a group, or moves it to another one (PATCH booking_group_id). */
export function MoveToGroupDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: Booking
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const id = useId()
  const [groupId, setGroupId] = useState("")
  const [error, setError] = useState<string | null>(null)
  const current = booking.booking_group?.id

  const close = () => {
    setGroupId("")
    setError(null)
    onOpenChange(false)
  }

  const mutation = useHapioMutation(
    (target: string) => hapio.bookings.patch(booking.id, { booking_group_id: target }),
    {
      success: current ? "Booking moved to group" : "Booking added to group",
      onSuccess: close,
    }
  )

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={current ? "Move to another group" : "Add to a booking group"}
      description="The booking keeps its times and status; only its group changes."
      submitLabel={current ? "Move booking" : "Add to group"}
      pending={mutation.isPending}
      onSubmit={(event) => {
        event.preventDefault()
        const target = groupId.trim()
        if (!UUID_RE.test(target)) {
          setError(target ? "Not a valid booking group ID." : "Enter or pick a booking group.")
          return
        }
        if (target === current) {
          setError("The booking is already in this group.")
          return
        }
        setError(null)
        mutation.mutate(target)
      }}
    >
      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor={id}>Booking group</FieldLabel>
        <BookingGroupIdInput
          id={id}
          value={groupId}
          exclude={current}
          invalid={!!error}
          onChange={(value) => {
            setGroupId(value)
            setError(null)
          }}
        />
        <FieldDescription>Paste a group ID or pick one of the most recent groups.</FieldDescription>
        {error && <FieldError>{error}</FieldError>}
      </Field>
    </FormDialog>
  )
}
