"use client"

import { useId, useState } from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { humanizeDuration, isZeroDuration } from "@/lib/format/duration"
import type { BookingEmbedded } from "@/lib/hapio/types"

import { bookingTimeRange, bookingTitle } from "./utils"

/** Confirms canceling a booking, optionally bypassing the service's cancelation threshold. */
export function CancelBookingDialog({
  booking,
  open,
  onOpenChange,
  onConfirm,
}: {
  booking: BookingEmbedded | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (options: { ignoreThreshold: boolean }) => Promise<unknown>
}) {
  const id = useId()
  const [ignoreThreshold, setIgnoreThreshold] = useState(false)
  const [pending, setPending] = useState(false)
  const threshold = booking?.service?.cancelation_threshold

  const close = () => {
    setIgnoreThreshold(false)
    onOpenChange(false)
  }

  const confirm = async () => {
    if (!booking) return
    setPending(true)
    try {
      await onConfirm({ ignoreThreshold })
      setPending(false)
      close()
    } catch {
      // The mutation hook has already shown the error.
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (next) onOpenChange(true)
        else close()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
          <AlertDialogDescription>
            {booking ? `${bookingTitle(booking)}, ${bookingTimeRange(booking)}. ` : ""}
            The booking is kept as canceled and its time is freed up. You can restore it later if the time is still
            available.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field orientation="horizontal">
          <Checkbox
            id={id}
            checked={ignoreThreshold}
            onCheckedChange={(checked) => setIgnoreThreshold(checked === true)}
            disabled={pending}
          />
          <FieldContent>
            <FieldLabel htmlFor={id}>Ignore cancelation threshold</FieldLabel>
            <FieldDescription>
              {threshold && !isZeroDuration(threshold)
                ? `This service's cancelation threshold is ${humanizeDuration(threshold)}. `
                : ""}
              Requires the booking:ignore_cancelation_threshold ability.
            </FieldDescription>
          </FieldContent>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep booking</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={pending || !booking} aria-busy={pending}>
            {pending && <Spinner aria-hidden />}
            Cancel booking
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
