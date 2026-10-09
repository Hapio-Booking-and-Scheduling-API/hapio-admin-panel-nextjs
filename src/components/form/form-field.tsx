"use client"

import { useId } from "react"
import {
  Controller,
  type Control,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"

interface FormFieldProps<T extends FieldValues, N extends FieldPath<T>> {
  control: Control<T>
  name: N
  label?: React.ReactNode
  description?: React.ReactNode
  orientation?: "vertical" | "horizontal"
  className?: string
  render: (props: {
    field: ControllerRenderProps<T, N>
    fieldState: ControllerFieldState
    id: string
    invalid: boolean
  }) => React.ReactElement
}

/** react-hook-form Controller wired to shadcn's Field components. */
export function FormField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  label,
  description,
  orientation = "vertical",
  className,
  render,
}: FormFieldProps<T, N>) {
  const id = useId()
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const control = render({ field, fieldState, id, invalid: fieldState.invalid })
        if (orientation === "horizontal") {
          return (
            <Field orientation="horizontal" data-invalid={fieldState.invalid} className={className}>
              {control}
              <FieldContent>
                {label && <FieldLabel htmlFor={id}>{label}</FieldLabel>}
                {description && <FieldDescription>{description}</FieldDescription>}
                <FieldError errors={[fieldState.error]} />
              </FieldContent>
            </Field>
          )
        }
        return (
          <Field data-invalid={fieldState.invalid} className={className}>
            {label && <FieldLabel htmlFor={id}>{label}</FieldLabel>}
            {control}
            {description && <FieldDescription>{description}</FieldDescription>}
            <FieldError errors={[fieldState.error]} />
          </Field>
        )
      }}
    />
  )
}
