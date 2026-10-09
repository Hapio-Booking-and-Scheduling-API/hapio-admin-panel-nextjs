"use client"

import { BracesIcon, CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"

import { ErrorAlert } from "@/components/entity/error-alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

/**
 * Shows the raw API response and offers a full replace (HTTP PUT) by editing
 * JSON — an escape hatch that exposes every writable field.
 */
export function RawJsonCard<T>({
  value,
  toPutBody,
  onReplace,
  description = "The raw API response.",
}: {
  value: T
  /** Converts the response into a PUT body (writable fields only). */
  toPutBody?: (value: T) => unknown
  onReplace?: (body: unknown) => Promise<unknown>
  description?: string
}) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(value, null, 2)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BracesIcon className="size-4" /> JSON
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(json)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />} Copy
          </Button>
          {toPutBody && onReplace && (
            <ReplaceDialog initial={toPutBody(value)} onReplace={onReplace} />
          )}
        </CardAction>
      </CardHeader>
      <CardContent>
        <pre className="max-h-[32rem] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
          {json}
        </pre>
      </CardContent>
    </Card>
  )
}

function ReplaceDialog({
  initial,
  onReplace,
}: {
  initial: unknown
  onReplace: (body: unknown) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [parseError, setParseError] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)

  const submit = async () => {
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON")
      return
    }
    setParseError(null)
    setError(null)
    setPending(true)
    try {
      await onReplace(body)
      setOpen(false)
    } catch (e) {
      setError(e)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setText(JSON.stringify(initial, null, 2))
          setParseError(null)
          setError(null)
        }
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Replace (PUT)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Replace via JSON</DialogTitle>
          <DialogDescription>
            Sends an HTTP PUT with this body. Fields you leave out are reset to their defaults.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={18}
          spellCheck={false}
          aria-invalid={!!parseError || undefined}
          className="max-h-[60vh] font-mono text-xs"
        />
        {parseError && <p className="text-sm text-destructive">{parseError}</p>}
        {error ? <ErrorAlert error={error} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Spinner />} Replace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
