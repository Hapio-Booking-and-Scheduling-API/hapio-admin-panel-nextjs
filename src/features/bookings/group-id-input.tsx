"use client"

import { keepPreviousData } from "@tanstack/react-query"
import { ChevronDownIcon, XIcon } from "lucide-react"
import { useState } from "react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { formatDateTime } from "@/lib/format/datetime"
import { hapio, type BookingGroupListParams } from "@/lib/hapio/client"
import { hapioKey } from "@/lib/hapio/hooks"

import { groupSpan, shortId, uniqueNames } from "./utils"
import { useHapioQuery } from "@/lib/hapio/use-hapio-query"

const RECENT_PARAMS: BookingGroupListParams = {
  per_page: 25,
  sort: "created_at.desc",
  temporary: "include",
  canceled: "include",
}

/** Booking group ID as text, with a picker of recent groups. "" = no group. */
export function BookingGroupIdInput({
  value,
  onChange,
  id,
  invalid,
  disabled,
  exclude,
}: {
  value: string
  onChange: (value: string) => void
  id?: string
  invalid?: boolean
  disabled?: boolean
  /** Group to leave out of the picker (e.g. the current one). */
  exclude?: string
}) {
  const [open, setOpen] = useState(false)
  const recent = useHapioQuery({
    queryKey: hapioKey("booking-groups", "list", RECENT_PARAMS),
    queryFn: ({ signal }) => hapio.bookingGroups.list(RECENT_PARAMS, signal),
    enabled: open,
    placeholderData: keepPreviousData,
  })
  const groups = (recent.data?.data ?? []).filter((g) => g.id !== exclude)

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        value={value}
        disabled={disabled}
        placeholder="No group"
        spellCheck={false}
        autoComplete="off"
        className="font-mono text-xs"
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <InputGroupAddon align="inline-end">
        {value && !disabled && (
          <InputGroupButton size="icon-xs" aria-label="Clear group" onClick={() => onChange("")}>
            <XIcon />
          </InputGroupButton>
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <InputGroupButton disabled={disabled} aria-label="Pick a recent booking group">
              Recent <ChevronDownIcon />
            </InputGroupButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
            <Command>
              <CommandInput placeholder="Search recent groups…" />
              <CommandList>
                <CommandEmpty>{recent.isLoading ? "Loading…" : "No booking groups found."}</CommandEmpty>
                <CommandGroup heading="Recently created">
                  {groups.map((group) => {
                    const span = groupSpan(group.bookings)
                    const services = uniqueNames(group.bookings, "service").join(", ")
                    return (
                      <CommandItem
                        key={group.id}
                        value={`${group.id} ${services}`}
                        onSelect={() => {
                          onChange(group.id)
                          setOpen(false)
                        }}
                      >
                        <span className="font-mono text-xs">{shortId(group.id)}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {group.bookings.length} {group.bookings.length === 1 ? "booking" : "bookings"}
                          {span ? ` · ${formatDateTime(span.starts_at, { pattern: "d MMM yyyy" })}` : ""}
                          {services ? ` · ${services}` : ""}
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  )
}
