"use client"

import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"

export function CopyId({ id, short = false, className }: { id: string; short?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 font-mono text-xs", className)}>
      <span className="truncate" title={id}>
        {short ? `${id.slice(0, 8)}…` : id}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Copy ID"
        onClick={async (event) => {
          event.stopPropagation()
          await navigator.clipboard.writeText(id)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </span>
  )
}
