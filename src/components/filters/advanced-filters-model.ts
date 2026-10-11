import { parseAsJson } from "nuqs"

import { OPERATORS, type MetadataFilter, type MetadataOperator, type OperatorFilter } from "@/lib/hapio/query"

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

/** A new, empty condition for the first field. */
export function emptyRow(fields: FilterFieldDef[]): FilterRow {
  return { field: fields[0].key, op: "gte", value: "" }
}

/**
 * Switches a row to another field, clearing what no longer applies. A metadata-only
 * operator (seq, slt, …) falls back to the default ≥, which every plain field accepts.
 */
export function changeRowField(row: FilterRow, field: string, fields: FilterFieldDef[]): FilterRow {
  const def = fields.find((f) => f.key === field)
  const op: MetadataOperator =
    def?.type === "metadata" ? "eq" : (OPERATORS as readonly string[]).includes(row.op) ? row.op : "gte"
  return { field, value: "", property: undefined, op }
}

/** Rows worth applying: a value, and a property for metadata rows. */
export function completeRows(rows: FilterRow[], fields: FilterFieldDef[]): FilterRow[] {
  return rows.filter((r) => r.value !== "" && (fields.find((f) => f.key === r.field)?.type !== "metadata" || r.property))
}

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

export const TIMESTAMP_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "created_at", label: "Created", type: "datetime" },
  { key: "updated_at", label: "Updated", type: "datetime" },
]

export const METADATA_FILTER_FIELDS: FilterFieldDef[] = [
  { key: "metadata", label: "Metadata", type: "metadata" },
  { key: "protected_metadata", label: "Protected metadata", type: "metadata" },
]
