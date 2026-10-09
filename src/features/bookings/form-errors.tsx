import { TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/** Server messages that couldn't be attached to a field (for full-page forms; dialogs use FormDialog's). */
export function FormErrorsAlert({ errors, title = "Hapio rejected the request" }: { errors: string[]; title?: string }) {
  if (!errors.length) return null
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {errors.map((message, i) => (
            <li key={i}>{message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
