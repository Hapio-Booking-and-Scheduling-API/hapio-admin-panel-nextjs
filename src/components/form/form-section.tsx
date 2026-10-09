import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field"

export function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <FieldSet>
      <FieldLegend>{title}</FieldLegend>
      {description && <FieldDescription>{description}</FieldDescription>}
      {children}
    </FieldSet>
  )
}
