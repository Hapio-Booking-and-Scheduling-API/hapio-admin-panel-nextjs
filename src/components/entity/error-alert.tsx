"use client"

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { describeError, isHapioError } from "@/lib/hapio/errors"

export function ErrorAlert({
  error,
  title,
  onRetry,
}: {
  error: unknown
  title?: string
  onRetry?: () => void
}) {
  const fieldErrors = isHapioError(error) && error.errors ? Object.entries(error.errors) : []
  const messages = isHapioError(error) && error.messages ? Object.entries(error.messages) : []
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>
        {title ?? (isHapioError(error) && error.status ? `Request failed (${error.status})` : "Request failed")}
      </AlertTitle>
      <AlertDescription>
        <p>{describeError(error)}</p>
        {(fieldErrors.length > 0 || messages.length > 0) && (
          <ul className="mt-1 list-disc pl-4">
            {fieldErrors.map(([field, errs]) => (
              <li key={field}>
                <code>{field}</code>: {errs.join(" ")}
              </li>
            ))}
            {messages.map(([field, message]) => (
              <li key={field}>
                <code>{field}</code>: {message}
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
      {onRetry && (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon /> Retry
          </Button>
        </AlertAction>
      )}
    </Alert>
  )
}
