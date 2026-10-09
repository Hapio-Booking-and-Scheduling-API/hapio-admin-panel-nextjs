// Serialises list parameters into Hapio's filter syntax:
//   key=value
//   key[op]=value                         (comparison operators)
//   metadata[prop->nested][op]=value      (metadata & protected_metadata filters)
//   sort=a.asc,b.desc

export const OPERATORS = ["eq", "lt", "lte", "gt", "gte"] as const
export type Operator = (typeof OPERATORS)[number]

export const METADATA_OPERATORS = [
  ...OPERATORS,
  "seq",
  "slt",
  "slte",
  "sgt",
  "sgte",
] as const
export type MetadataOperator = (typeof METADATA_OPERATORS)[number]

export const OPERATOR_LABELS: Record<MetadataOperator, string> = {
  eq: "=",
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  seq: "= (string)",
  slt: "< (string)",
  slte: "≤ (string)",
  sgt: "> (string)",
  sgte: "≥ (string)",
}

export type OperatorFilter<T = string | number> = Partial<Record<Operator, T>>

export interface MetadataFilter {
  /** Property path; nested properties are separated with `->`, e.g. `customer->name`. */
  property: string
  operator: MetadataOperator
  value: string
}

type Primitive = string | number | boolean
export type QueryValue =
  | Primitive
  | null
  | undefined
  | Primitive[]
  | OperatorFilter
  | MetadataFilter[]

export type QueryParams = Record<string, QueryValue>

function isMetadataFilterList(value: unknown): value is MetadataFilter[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (v) => typeof v === "object" && v !== null && "property" in v && "operator" in v
    )
  )
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === ""
}

export function toSearchParams(params: QueryParams | undefined): URLSearchParams {
  const search = new URLSearchParams()
  if (!params) return search

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue

    if (isMetadataFilterList(value)) {
      for (const filter of value) {
        const property = filter.property.trim()
        if (!property || isEmpty(filter.value)) continue
        search.append(`${key}[${property}][${filter.operator}]`, String(filter.value))
      }
      continue
    }

    if (Array.isArray(value)) {
      const items = value.filter((v) => !isEmpty(v)).map(String)
      if (items.length) search.append(key, items.join(","))
      continue
    }

    if (typeof value === "object") {
      for (const [op, opValue] of Object.entries(value)) {
        if (isEmpty(opValue)) continue
        search.append(`${key}[${op}]`, String(opValue))
      }
      continue
    }

    search.append(key, String(value))
  }

  return search
}

export function buildQuery(params: QueryParams | undefined): string {
  const qs = toSearchParams(params).toString()
  return qs ? `?${qs}` : ""
}
