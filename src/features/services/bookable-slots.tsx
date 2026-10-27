"use client"

import type { UseQueryResult } from "@tanstack/react-query"
import {
  CalendarPlusIcon,
  CalendarSearchIcon,
  CalendarXIcon,
  ChevronDownIcon,
  InfoIcon,
  SearchIcon,
} from "lucide-react"
import Link from "next/link"
import { useId, useMemo, useState } from "react"
import { cn } from "cn"

import { ErrorAlert } from "@/components/entity/error-alert"
import { SectionCard } from "@/components/entity/section-card"
import { EntityCombobox } from "@/components/inputs/entity-combobox"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { can } from "@/lib/admin-config"
import { browserTimeZone, formatDateTime, toHapioDateTime, todayIn } from "@/lib/format/datetime"
import { isValidDuration, isZeroDuration } from "@/lib/format/duration"
import type { BookableSlotParams } from "@/lib/hapio/client"
import { isHapioError } from "@/lib/hapio/errors"
import { indexById, useAllLocations } from "@/lib/hapio/hooks"
import type { AnyBookableSlot, ResourceService, Service } from "@/lib/hapio/types"

import { useBookableSlots } from "./hooks"
import { OptionalDuration } from "./optional-duration"
import {
  PRESETS,
  addDaysTo,
  bookingHref,
  defaultLength,
  endOptions,
  fallbackLength,
  hasEndRange,
  lengthLabel,
  presetRange,
  toZoned,
  type Preset,
} from "./slots-model"

// ---------------------------------------------------------------------------
// Helpers

const fmt = (iso: string, timeZone: string, pattern: string) => formatDateTime(iso, { timeZone, pattern })
const dayKey = (iso: string, timeZone: string) => fmt(iso, timeZone, "yyyy-MM-dd")

interface Search {
  params: Omit<BookableSlotParams, "page" | "per_page">
  locationId: string
  resourceId: string | null
  timeZone: string
}

// ---------------------------------------------------------------------------
// Explorer

export function BookableSlotsExplorer({
  service,
  resources,
  onShowResources,
}: {
  service: Service
  resources: UseQueryResult<ResourceService[]>
  onShowResources: () => void
}) {
  const baseId = useId()
  const ids = {
    location: `${baseId}-location`,
    resource: `${baseId}-resource`,
    from: `${baseId}-from`,
    length: `${baseId}-length`,
    count: `${baseId}-count`,
    ignore: `${baseId}-ignore`,
  }
  const locations = useAllLocations()
  const [locationId, setLocationId] = useState<string | null>(null)
  const [resourceId, setResourceId] = useState<string | null>(null)
  const [preset, setPreset] = useState<Preset | null>("7d")
  const [customRange, setCustomRange] = useState({ from: "", to: "" })
  const [length, setLength] = useState<string | null>(() => defaultLength(service))
  const [numResources, setNumResources] = useState("")
  const [ignoreWindow, setIgnoreWindow] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [search, setSearch] = useState<Search | null>(null)
  const slots = useBookableSlots(service.id, search?.params ?? null)

  // With a single location there's nothing to pick.
  const effectiveLocationId = locationId ?? (locations.data?.length === 1 ? locations.data[0].id : null)
  const location = effectiveLocationId ? indexById(locations.data).get(effectiveLocationId) : undefined
  const timeZone = location?.time_zone ?? browserTimeZone()
  const range = preset ? presetRange(preset, timeZone) : customRange
  const hasLength = service.type !== "fixed"
  const associatedIds = resources.data?.map((r) => r.resource_id)

  const validate = () => {
    const errors: Partial<Record<"location" | "range" | "length" | "numResources", string>> = {}
    if (!effectiveLocationId) errors.location = "Select a location"
    if (!range.from || !range.to) errors.range = "Pick a start and end date"
    else if (range.to < range.from) errors.range = "The end date must be on or after the start date"
    if (hasLength && length !== null) {
      if (!isValidDuration(length)) errors.length = "Not a valid ISO 8601 duration"
      else if (isZeroDuration(length)) errors.length = "Must be longer than zero"
    }
    if (numResources && !(/^\d+$/.test(numResources) && Number(numResources) >= 1)) {
      errors.numResources = "Enter a whole number of at least 1"
    }
    return errors
  }
  const errors = attempted ? validate() : {}

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setAttempted(true)
    if (Object.keys(validate()).length || !effectiveLocationId) return
    const params: Search["params"] = {
      location: effectiveLocationId,
      from: toHapioDateTime(`${range.from}T00:00`, timeZone),
      to: toHapioDateTime(`${addDaysTo(range.to, 1)}T00:00`, timeZone),
      resource: resourceId ?? undefined,
      duration: hasLength && length ? length : undefined,
      num_resources: numResources ? Number(numResources) : undefined,
      ignore_booking_window: ignoreWindow ? "true" : undefined,
    }
    // Searching again with the same parameters re-queries instead of reusing the cache.
    if (search && JSON.stringify(search.params) === JSON.stringify(params)) {
      void slots.refetch()
      return
    }
    setSearch({ params, locationId: effectiveLocationId, resourceId, timeZone })
  }

  return (
    <div className="flex flex-col gap-4">
      {associatedIds && associatedIds.length === 0 && (
        <Alert>
          <InfoIcon />
          <AlertTitle>No resources associated</AlertTitle>
          <AlertDescription>
            Slots come from the schedules of resources associated with this service. Associate at least one resource
            first.
          </AlertDescription>
          <AlertAction>
            <Button variant="outline" size="sm" onClick={onShowResources}>
              Resources
            </Button>
          </AlertAction>
        </Alert>
      )}
      <SectionCard
        title="Find bookable slots"
        description="See availability the way customers do: times when an associated resource has a schedule at the location and isn't fully booked."
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field data-invalid={!!errors.location}>
              <FieldLabel htmlFor={ids.location}>Location</FieldLabel>
              <EntityCombobox
                id={ids.location}
                kind="location"
                value={effectiveLocationId}
                onChange={setLocationId}
                invalid={!!errors.location}
              />
              {location && <FieldDescription>Times are shown in {location.time_zone}.</FieldDescription>}
              <FieldError>{errors.location}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.resource}>Resource</FieldLabel>
              <EntityCombobox
                id={ids.resource}
                kind="resource"
                value={resourceId}
                onChange={setResourceId}
                only={associatedIds ?? []}
                clearable
                placeholder="Any associated resource"
              />
              <FieldDescription>Optional. Limited to resources associated with this service.</FieldDescription>
            </Field>
            <Field data-invalid={!!errors.range} className="md:col-span-2">
              <FieldLabel htmlFor={ids.from}>Dates</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
                  <Input
                    id={ids.from}
                    type="date"
                    className="min-w-0 flex-1 sm:w-40 sm:flex-none"
                    aria-label="From date"
                    aria-invalid={!!errors.range || undefined}
                    value={range.from}
                    onChange={(e) => {
                      setPreset(null)
                      setCustomRange({ from: e.target.value, to: range.to })
                    }}
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="date"
                    className="min-w-0 flex-1 sm:w-40 sm:flex-none"
                    aria-label="To date"
                    aria-invalid={!!errors.range || undefined}
                    value={range.to}
                    min={range.from || undefined}
                    onChange={(e) => {
                      setPreset(null)
                      setCustomRange({ from: range.from, to: e.target.value })
                    }}
                  />
                </div>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  value={preset ?? ""}
                  onValueChange={(v) => v && setPreset(v as Preset)}
                  aria-label="Quick date ranges"
                >
                  {(Object.keys(PRESETS) as Preset[]).map((p) => (
                    <ToggleGroupItem
                      key={p}
                      value={p}
                      className="text-muted-foreground data-[state=on]:text-foreground"
                    >
                      {PRESETS[p].label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <FieldDescription>Both dates are included, in the location&apos;s time zone.</FieldDescription>
              <FieldError>{errors.range}</FieldError>
            </Field>
            {hasLength && (
              <Field data-invalid={!!errors.length}>
                <FieldLabel htmlFor={ids.length}>Length to fit</FieldLabel>
                <OptionalDuration
                  id={ids.length}
                  value={length}
                  onChange={setLength}
                  nullLabel="Service minimum"
                  fallback={fallbackLength(service)}
                  units={service.type === "day" ? ["days"] : undefined}
                  invalid={!!errors.length}
                />
                <FieldDescription>
                  {service.type === "day"
                    ? "Only show slots with room for this many days."
                    : "Only show slots with room for a booking this long."}
                </FieldDescription>
                <FieldError>{errors.length}</FieldError>
              </Field>
            )}
            <Field data-invalid={!!errors.numResources}>
              <FieldLabel htmlFor={ids.count}>Free resources</FieldLabel>
              <div>
                <Input
                  id={ids.count}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="1"
                  className="w-28"
                  aria-invalid={!!errors.numResources || undefined}
                  value={numResources}
                  onChange={(e) => setNumResources(e.target.value)}
                />
              </div>
              <FieldDescription>Minimum number of resources that must be free at the same time.</FieldDescription>
              <FieldError>{errors.numResources}</FieldError>
            </Field>
          </div>
          <Field orientation="horizontal">
            <Switch id={ids.ignore} checked={ignoreWindow} onCheckedChange={setIgnoreWindow} />
            <FieldContent>
              <FieldLabel htmlFor={ids.ignore}>Ignore booking window</FieldLabel>
              <FieldDescription>
                Include slots outside the service&apos;s minimum notice and booking horizon.
              </FieldDescription>
            </FieldContent>
          </Field>
          <div>
            <Button
              type="submit"
              disabled={slots.isFetching && !slots.isFetchingNextPage}
              aria-busy={slots.isFetching && !slots.isFetchingNextPage}
            >
              {slots.isFetching && !slots.isFetchingNextPage ? <Spinner aria-hidden /> : <SearchIcon />} Find slots
            </Button>
          </div>
        </form>
      </SectionCard>
      {search ? (
        <SlotResults service={service} search={search} query={slots} />
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarSearchIcon />
            </EmptyMedia>
            <EmptyTitle>Search for slots</EmptyTitle>
            <EmptyDescription>Pick a location and dates, then select Find slots.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Results

function SlotResults({
  service,
  search,
  query,
}: {
  service: Service
  search: Search
  query: ReturnType<typeof useBookableSlots>
}) {
  const { timeZone } = search

  const slots = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data])
  const groups = useMemo(() => {
    const map = new Map<string, AnyBookableSlot[]>()
    for (const slot of slots) {
      const key = dayKey(slot.starts_at, timeZone)
      const list = map.get(key)
      if (list) list.push(slot)
      else map.set(key, [slot])
    }
    return [...map.entries()]
  }, [slots, timeZone])

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading slots">
        <Skeleton className="h-5 w-48" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  if (query.error && !query.data) {
    const status = isHapioError(query.error) ? query.error.status : 0
    return (
      <div className="flex flex-col gap-2">
        <ErrorAlert error={query.error} title="Couldn't load bookable slots" onRetry={() => query.refetch()} />
        {(status === 404 || status === 422) && (
          <p className="text-sm text-muted-foreground">
            {status === 404
              ? "The service, location or resource wasn't found. It may have been deleted."
              : "Hapio rejected the search. Check the dates, length and number of resources."}
          </p>
        )}
      </div>
    )
  }

  if (!slots.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarXIcon />
          </EmptyMedia>
          <EmptyTitle>No bookable slots</EmptyTitle>
          <EmptyDescription>
            Nothing is free in this range. Slots need a resource that is associated with this service, has a
            schedule at this location and isn&apos;t fully booked. The booking window also applies unless you
            ignore it.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const total = query.data?.pages[0]?.meta.total ?? slots.length
  const today = todayIn(timeZone)
  const tomorrow = addDaysTo(today, 1)

  return (
    <div className={cn("flex flex-col gap-4 transition-opacity", query.isRefetching && !query.isFetchingNextPage && "opacity-70")}>
      <p className="text-sm text-muted-foreground">
        <span className="tabular-nums">
          {slots.length === total ? `${total} ${total === 1 ? "slot" : "slots"}` : `Showing ${slots.length} of ${total} slots`}
        </span>{" "}
        · times in {timeZone}
      </p>
      {groups.map(([key, daySlots]) => (
        <section key={key} aria-label={fmt(daySlots[0].starts_at, timeZone, "EEEE d MMMM yyyy")} className="flex flex-col gap-2">
          <h3 className="flex items-baseline gap-2 text-sm font-medium">
            {key === today ? "Today, " : key === tomorrow ? "Tomorrow, " : ""}
            {fmt(daySlots[0].starts_at, timeZone, "EEEE d MMMM yyyy")}
            <span className="font-normal text-muted-foreground tabular-nums">
              {daySlots.length} {daySlots.length === 1 ? "slot" : "slots"}
            </span>
          </h3>
          <ul className="divide-y rounded-lg border">
            {daySlots.map((slot) => (
              <SlotRow key={slotKey(slot)} slot={slot} dayKey={key} service={service} search={search} />
            ))}
          </ul>
        </section>
      ))}
      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            aria-busy={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage && <Spinner aria-hidden />}
            Load more
          </Button>
        </div>
      )}
      {query.error && query.data && <ErrorAlert error={query.error} title="Couldn't load more slots" />}
    </div>
  )
}

const MAX_BADGES = 6

/**
 * Identifies a slot by its times and resources, so a row starts over (with the minimum
 * end chosen) when a refetch changes the slot's possible ends or resources.
 */
const slotKey = (slot: AnyBookableSlot) =>
  [slot.starts_at, hasEndRange(slot) ? slot.min_ends_at : "", slot.ends_at, ...slot.resources.map((r) => r.id)].join("|")

function SlotRow({
  slot,
  dayKey: groupKey,
  service,
  search,
}: {
  slot: AnyBookableSlot
  dayKey: string
  service: Service
  search: Search
}) {
  const { timeZone } = search
  const ranged = hasEndRange(slot)
  // Day services show end dates, which say enough; flexible ones show the length.
  const showLength = ranged && service.type === "flexible"
  const options = useMemo(() => (ranged ? endOptions(slot, service, timeZone) : []), [ranged, slot, service, timeZone])
  const [chosenEnd, setChosenEnd] = useState(ranged ? slot.min_ends_at : slot.ends_at)

  const time = (iso: string) =>
    dayKey(iso, timeZone) === groupKey ? fmt(iso, timeZone, "HH:mm") : fmt(iso, timeZone, "EEE d MMM, HH:mm")

  const start = new Date(slot.starts_at).getTime()
  const end = new Date(chosenEnd).getTime()
  // Buffer after the chosen end equals the buffer after the minimum end.
  const bufferAfter = ranged
    ? new Date(slot.min_buffer_ends_at).getTime() - new Date(slot.min_ends_at).getTime()
    : new Date(slot.buffer_ends_at).getTime() - new Date(slot.ends_at).getTime()
  const bufferEnd = toZoned(end + bufferAfter, timeZone)
  const hasBuffers = slot.buffer_starts_at !== slot.starts_at || bufferAfter !== 0

  const extra = slot.resources.length - MAX_BADGES

  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="font-medium tabular-nums">
          {time(slot.starts_at)} – {time(chosenEnd)}
          {showLength && <span className="ml-2 font-normal text-muted-foreground">{lengthLabel(end - start)}</span>}
        </p>
        {ranged && slot.min_ends_at !== slot.ends_at && (
          <p className="text-xs text-muted-foreground tabular-nums">
            Can end between {time(slot.min_ends_at)} and {time(slot.ends_at)}
          </p>
        )}
        {hasBuffers && (
          <p className="text-xs text-muted-foreground tabular-nums">
            Blocked {time(slot.buffer_starts_at)} – {time(bufferEnd)} with buffers
          </p>
        )}
        <div className="flex flex-wrap gap-1 pt-0.5">
          {slot.resources.slice(0, MAX_BADGES).map((r) => (
            <Badge key={r.id} variant="secondary" className="font-normal">
              {r.name}
            </Badge>
          ))}
          {extra > 0 && (
            <Badge variant="outline" className="font-normal" title={slot.resources.slice(MAX_BADGES).map((r) => r.name).join(", ")}>
              +{extra} more
            </Badge>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {ranged && options.length > 1 && (
          <Select value={chosenEnd} onValueChange={setChosenEnd}>
            <SelectTrigger size="sm" className="w-auto min-w-36" aria-label="Booking end">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end" className="max-h-72">
              {options.map((iso) => (
                <SelectItem key={iso} value={iso}>
                  Ends {time(iso)}
                  {showLength && (
                    <span className="text-muted-foreground">· {lengthLabel(new Date(iso).getTime() - start)}</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {can("bookings", "create") && (
          <BookButton slot={slot} serviceId={service.id} search={search} endsAt={chosenEnd} />
        )}
      </div>
    </li>
  )
}

function BookButton({
  slot,
  serviceId,
  search,
  endsAt,
}: {
  slot: AnyBookableSlot
  serviceId: string
  search: Search
  endsAt: string
}) {
  const href = (resourceId: string | null) =>
    bookingHref({ serviceId, locationId: search.locationId, resourceId, startsAt: slot.starts_at, endsAt })

  if (search.resourceId || slot.resources.length <= 1) {
    return (
      <Button size="sm" asChild>
        <Link href={href(search.resourceId ?? slot.resources[0]?.id ?? null)}>
          <CalendarPlusIcon /> Book
        </Link>
      </Button>
    )
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <CalendarPlusIcon /> Book <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        <DropdownMenuItem asChild>
          <Link href={href(null)}>Any available (auto-select)</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Specific resource</DropdownMenuLabel>
        {slot.resources.map((r) => (
          <DropdownMenuItem key={r.id} asChild>
            <Link href={href(r.id)}>{r.name}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
