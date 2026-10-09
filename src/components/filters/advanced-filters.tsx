"use client"

import { FilterIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { parseAsJson } from "nuqs"
import { useState } from "react"

import { DateTimeInput } from "@/components/inputs/date-time-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatDateTime, normalizeTime } from "@/lib/format/datetime"
import { normalizePrice } from "@/lib/format/price"
import {
  METADATA_OPERATORS,
  OPERATOR_LABELS,
  OPERATORS,
  type MetadataFilter,
  type MetadataOperator,
  type OperatorFilter,
} from "@/lib/hapio/query"

export type FilterFieldType = "datetime" | "date" | "time" | "number" | "text" | "price" | "metadata"

export interface FilterFieldDef {
  /** Hapio query key, e.g. "starts_at", "metadata", "group_created_at". */
  key: string
  label: string
  type: FilterFieldType
}

export interface FilterRow {
  field: string
  property?: string
  op: MetadataOperator
  value: string
}

function isFilterRow(value: unknown): value is FilterRow {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return typeof row.field === "string" && typeof row.op === "string" && typeof row.value === "string"
}

/** nuqs parser for filter rows kept in the URL (`?f=[...]`). */
export const parseAsFilterRows = parseAsJson<FilterRow[]>((value) =>
  Array.isArray(value) ? value.filter(isFilterRow) : null
)

/** Converts rows into Hapio query params (`key[op]=v`, `metadata[prop][op]=v`). */
export function rowsToParams(
  rows: FilterRow[] | null | undefined,
  fields: FilterFieldDef[]
): Record<string, OperatorFilter | MetadataFilter[]> {
  const params: Record<string, OperatorFilter | MetadataFilter[]> = {}
  for (const row of rows ?? []) {
    const def = fields.find((f) => f.key === row.field)
    if (!def || row.value === "") continue
    if (def.type === "metadata") {
      if (!row.property) continue
      const list = (params[def.key] as MetadataFilter[] | undefined) ?? []
      list.push({ property: row.property, operator: row.op, value: row.value })
      params[def.key] = list
    } else {
      const existing = (params[def.key] as OperatorFilter | undefined) ?? {}
      params[def.key] = { ...existing, [row.op]: row.value }
    }
  }
  return params
}

function displayValue(row: FilterRow, def: FilterFieldDef | undefined) {
  if (def?.type === "datetime") return formatDateTime(row.value)
  return row.value
}

function ValueInput({
  row,
  def,
  onChange,
}: {
  row: FilterRow
  def: FilterFieldDef | undefined
  onChange: (value: string) => void
}) {
  switch (def?.type) {
    case "datetime":
      return <DateTimeInput value={row.value} onChange={onChange} showZone={false} size="sm" />
    case "date":
      return <Input type="date" className="h-7" value={row.value} onChange={(e) => onChange(e.target.value)} />
    case "time":
      return (
        <Input
          type="time"
          className="h-7"
          value={row.value.slice(0, 5)}
          onChange={(e) => onChange(e.target.value ? normalizeTime(e.target.value) : "")}
        />
      )
    case "number":
      return <Input type="number" className="h-7" value={row.value} onChange={(e) => onChange(e.target.value)} />
    case "price":
      return (
        <Input
          inputMode="decimal"
          className="h-7"
          placeholder="0.000"
          value={row.value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            const p = normalizePrice(row.value)
            if (p) onChange(p)
          }}
        />
      )
    default:
      return <Input className="h-7" value={row.value} placeholder="Value" onChange={(e) => onChange(e.target.value)} />
  }
}

/**
 * Builder for Hapio's comparison filters (`field[op]=value`) and metadata
 * filters (`metadata[prop][op]=value`). Rows are applied together (AND).
 */
export function AdvancedFilters({
  fields,
  value,
  onChange,
}: {
  fields: FilterFieldDef[]
  value: FilterRow[] | null
  onChange: (rows: FilterRow[] | null) => void
}) {
  const applied = value ?? []
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<FilterRow[]>(applied)

  const defOf = (key: string) => fields.find((f) => f.key === key)
  const update = (index: number, patch: Partial<FilterRow>) =>
    setDraft((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const apply = () => {
    const rows = draft.filter((r) => r.value !== "" && (defOf(r.field)?.type !== "metadata" || r.property))
    onChange(rows.length ? rows : null)
    setOpen(false)
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) setDraft(applied.length ? applied : [{ field: fields[0].key, op: "gte", value: "" }])
          setOpen(next)
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <FilterIcon /> Filters
            {applied.length > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 tabular-nums">
                {applied.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(40rem,calc(100vw-2rem))] p-3">
          <div className="space-y-2">
            <p className="text-sm font-medium">Advanced filters</p>
            <p className="text-xs text-muted-foreground">
              All conditions must match. Nested metadata properties use <code>-&gt;</code>, e.g.{" "}
              <code>customer-&gt;name</code>. Operators ending in “(string)” compare as text.
            </p>
            {draft.map((row, index) => {
              const def = defOf(row.field)
              const ops = def?.type === "metadata" ? METADATA_OPERATORS : OPERATORS
              return (
                <div key={index} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border p-2 sm:grid-cols-[10rem_auto_1fr_auto] sm:border-0 sm:p-0">
                  <Select
                    value={row.field}
                    onValueChange={(field) =>
                      update(index, { field, value: "", property: undefined, op: defOf(field)?.type === "metadata" ? "eq" : row.op })
                    }
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fields.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={row.op} onValueChange={(op) => update(index, { op: op as MetadataOperator })}>
                    <SelectTrigger size="sm" className="w-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ops.map((op) => (
                        <SelectItem key={op} value={op}>
                          {OPERATOR_LABELS[op]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="col-span-2 flex gap-2 sm:col-span-1">
                    {def?.type === "metadata" && (
                      <Input
                        className="h-7 w-32 font-mono text-xs"
                        placeholder="property"
                        value={row.property ?? ""}
                        onChange={(e) => update(index, { property: e.target.value })}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <ValueInput row={row} def={def} onChange={(v) => update(index, { value: v })} />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"
                    aria-label="Remove filter"
                    onClick={() => setDraft((rows) => rows.filter((_, i) => i !== index))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              )
            })}
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDraft((rows) => [...rows, { field: fields[0].key, op: "gte", value: "" }])}
              >
                <PlusIcon /> Add condition
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDraft([])
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  Clear
                </Button>
                <Button size="sm" onClick={apply}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {applied.map((row, index) => {
        const def = defOf(row.field)
        return (
          <Badge key={index} variant="secondary" className="h-7 gap-1 pr-1 font-normal">
            <span className="font-medium">{def?.label ?? row.field}</span>
            {row.property && <code className="text-xs">[{row.property}]</code>}
            <span>{OPERATOR_LABELS[row.op]}</span>
            <span className="max-w-40 truncate">{displayValue(row, def)}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Remove filter"
              onClick={() => {
                const rows = applied.filter((_, i) => i !== index)
                onChange(rows.length ? rows : null)
              }}
            >
              <XIcon />
            </Button>
          </Badge>
        )
      })}
    </>
  )
}

export const TIMESTAMP_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "created_at", label: "Created", type: "datetime" },
  { key: "updated_at", label: "Updated", type: "datetime" },
]

export const METADATA_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "metadata", label: "Metadata", type: "metadata" },
  { key: "protected_metadata", label: "Protected metadata", type: "metadata" },
]
