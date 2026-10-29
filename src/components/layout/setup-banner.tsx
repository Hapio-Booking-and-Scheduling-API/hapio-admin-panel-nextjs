"use client"

import { KeyRoundIcon, TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { describeError, hasOwnMessage, isHapioError } from "@/lib/hapio/errors"
import { useProject } from "@/lib/hapio/hooks"

/** Explains what's wrong when the proxy has no token or Hapio rejects it. */
export function SetupBanner() {
  const { error } = useProject()
  if (!error || !isHapioError(error)) return null

  if (error.isNotConfigured) {
    return (
      <Alert>
        <KeyRoundIcon />
        <AlertTitle>Connect your Hapio project</AlertTitle>
        <AlertDescription>
          <p>
            Create an API token in the Hapio portal, add it to <code>.env.local</code> as{" "}
            <code>HAPIO_API_TOKEN=…</code>, then restart the dev server.
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  // A proxy in front of Hapio, like the website demo's, explains its own 401s.
  if (error.status === 401 && hasOwnMessage(error)) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>{error.message}</AlertTitle>
      </Alert>
    )
  }

  if (error.status === 401) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Hapio rejected the API token</AlertTitle>
        <AlertDescription>
          Check <code>HAPIO_API_TOKEN</code> in <code>.env.local</code>. {describeError(error)}
        </AlertDescription>
      </Alert>
    )
  }

  if (error.status === 0 || error.status === 502) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Can&apos;t reach Hapio</AlertTitle>
        <AlertDescription>{describeError(error)}</AlertDescription>
      </Alert>
    )
  }

  // 404 means the token isn't tied to a project; other pages still work.
  return null
}
