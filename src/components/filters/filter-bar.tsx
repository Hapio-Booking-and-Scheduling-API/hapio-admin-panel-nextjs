"use client"

import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function FilterBar({
  children,
  onReset,
  canReset,
}: {
  children: React.ReactNode
  onReset?: () => void
  canReset?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {onReset && canReset && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <XIcon /> Reset
        </Button>
      )}
    </div>
  )
}
