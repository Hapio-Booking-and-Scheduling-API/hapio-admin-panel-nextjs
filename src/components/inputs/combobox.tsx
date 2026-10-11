"use client"

import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"

export interface ComboboxOption {
  value: string
  label: string
  /** Extra text that is searchable and shown muted. */
  hint?: string
  disabled?: boolean
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string | null | undefined
  onChange: (value: string | null) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  loading?: boolean
  clearable?: boolean
  disabled?: boolean
  id?: string
  className?: string
  invalid?: boolean
  size?: "sm" | "default"
  /** Accessible name when no visible <label> points at the trigger (e.g. filter bars). */
  "aria-label"?: string
  "aria-labelledby"?: string
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  loading,
  clearable,
  disabled,
  id,
  className,
  invalid,
  size = "default",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative flex w-full min-w-0", className)}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            size={size}
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={cn(
              "w-full min-w-0 justify-between font-normal",
              !selected && "text-muted-foreground",
              clearable && selected && "pr-14"
            )}
          >
            <span className="truncate">
              {selected ? selected.label : value ? `${value.slice(0, 8)}…` : placeholder}
            </span>
            {loading ? <Spinner aria-hidden /> : <ChevronsUpDownIcon className="opacity-50" />}
          </Button>
        </PopoverTrigger>
        {clearable && value && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-1/2 right-7 -translate-y-1/2"
            aria-label={`Clear ${ariaLabel ? ariaLabel.toLowerCase() : "selection"}`}
            onClick={() => onChange(null)}
          >
            <XIcon />
          </Button>
        )}
      </div>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{loading ? "Loading…" : emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.hint ?? ""} ${option.value}`}
                  disabled={option.disabled}
                  onSelect={() => {
                    onChange(option.value === value && clearable ? null : option.value)
                    setOpen(false)
                  }}
                >
                  <CheckIcon className={cn(option.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{option.label}</span>
                  {option.hint && (
                    <span className="ml-auto truncate text-xs text-muted-foreground">{option.hint}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
