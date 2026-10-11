import { describe, expect, it } from "vitest"

import {
  changeRowField,
  completeRows,
  emptyRow,
  METADATA_FILTER_FIELDS,
  parseAsFilterRows,
  rowsToParams,
  TIMESTAMP_FILTER_FIELDS,
  type FilterFieldDef,
  type FilterRow,
} from "@/components/filters/advanced-filters-model"
import { OPERATORS } from "@/lib/hapio/query"

// Same shape as the locations page: a text field, timestamps and metadata.
const FIELDS: FilterFieldDef[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "price", label: "Price", type: "price" },
  ...TIMESTAMP_FILTER_FIELDS,
  ...METADATA_FILTER_FIELDS,
]

describe("shared field lists", () => {
  it("define timestamp and metadata fields", () => {
    expect(TIMESTAMP_FILTER_FIELDS).toEqual([
      { key: "created_at", label: "Created", type: "datetime" },
      { key: "updated_at", label: "Updated", type: "datetime" },
    ])
    expect(METADATA_FILTER_FIELDS).toEqual([
      { key: "metadata", label: "Metadata", type: "metadata" },
      { key: "protected_metadata", label: "Protected metadata", type: "metadata" },
    ])
  })
})

describe("emptyRow", () => {
  it("starts on the first field with ≥ and no value", () => {
    expect(emptyRow(FIELDS)).toEqual({ field: "name", op: "gte", value: "" })
    expect(emptyRow(METADATA_FILTER_FIELDS)).toEqual({ field: "metadata", op: "gte", value: "" })
  })
})

describe("changeRowField", () => {
  const row: FilterRow = { field: "created_at", op: "lt", value: "2026-10-21T00:00:00+02:00" }

  it("clears the value and property but keeps a comparison operator between plain fields", () => {
    expect(changeRowField({ ...row, property: "stale" }, "updated_at", FIELDS)).toEqual({
      field: "updated_at",
      op: "lt",
      value: "",
      property: undefined,
    })
  })

  it("switches to = (eq) when moving to a metadata field", () => {
    expect(changeRowField(row, "metadata", FIELDS)).toEqual({
      field: "metadata",
      op: "eq",
      value: "",
      property: undefined,
    })
  })

  it("keeps a comparison operator chosen on a metadata row when moving to a plain field", () => {
    const meta: FilterRow = { field: "metadata", property: "floor", op: "gte", value: "2" }
    expect(changeRowField(meta, "created_at", FIELDS)).toMatchObject({ field: "created_at", op: "gte", value: "" })
  })

  it("resets a metadata-only operator (seq) when moving to a datetime field", () => {
    const meta: FilterRow = { field: "metadata", property: "customer->name", op: "seq", value: "Ann" }
    const next = changeRowField(meta, "created_at", FIELDS)
    expect(OPERATORS as readonly string[]).toContain(next.op)
  })

  it("resets a metadata-only operator (sgte) when moving to a text field", () => {
    const meta: FilterRow = { field: "protected_metadata", property: "rank", op: "sgte", value: "b" }
    const next = changeRowField(meta, "name", FIELDS)
    expect(OPERATORS as readonly string[]).toContain(next.op)
    // What the panel would send today: name[sgte]=…, which Hapio rejects with a 422.
    expect(Object.keys(rowsToParams([{ ...next, value: "Studio" }], FIELDS).name ?? {})).not.toContain("sgte")
  })
})

describe("completeRows", () => {
  it("keeps rows with a value, and metadata rows only with a property", () => {
    const rows: FilterRow[] = [
      { field: "name", op: "eq", value: "Studio" },
      { field: "name", op: "eq", value: "" },
      { field: "metadata", op: "eq", value: "2" },
      { field: "metadata", property: "", op: "eq", value: "2" },
      { field: "metadata", property: "floor", op: "eq", value: "2" },
      { field: "metadata", property: "floor", op: "eq", value: "" },
    ]
    expect(completeRows(rows, FIELDS)).toEqual([rows[0], rows[4]])
  })

  it("keeps rows of unknown fields that have a value (rowsToParams skips them later)", () => {
    const rows: FilterRow[] = [{ field: "gone", op: "eq", value: "x" }]
    expect(completeRows(rows, FIELDS)).toEqual(rows)
  })
})

describe("rowsToParams", () => {
  it("returns nothing for null, undefined or no rows", () => {
    expect(rowsToParams(null, FIELDS)).toEqual({})
    expect(rowsToParams(undefined, FIELDS)).toEqual({})
    expect(rowsToParams([], FIELDS)).toEqual({})
  })

  it("builds operator filters for plain fields", () => {
    expect(rowsToParams([{ field: "name", op: "eq", value: "Studio" }], FIELDS)).toEqual({ name: { eq: "Studio" } })
  })

  it("merges several operators on one field", () => {
    expect(
      rowsToParams(
        [
          { field: "created_at", op: "gte", value: "2026-10-01T00:00:00+02:00" },
          { field: "created_at", op: "lt", value: "2026-11-01T00:00:00+01:00" },
          { field: "price", op: "lte", value: "450.000" },
        ],
        FIELDS
      )
    ).toEqual({
      created_at: { gte: "2026-10-01T00:00:00+02:00", lt: "2026-11-01T00:00:00+01:00" },
      price: { lte: "450.000" },
    })
  })

  it("lets a later row with the same operator overwrite an earlier one", () => {
    expect(
      rowsToParams(
        [
          { field: "name", op: "eq", value: "First" },
          { field: "name", op: "eq", value: "Second" },
        ],
        FIELDS
      )
    ).toEqual({ name: { eq: "Second" } })
  })

  it("skips unknown fields and empty values", () => {
    expect(
      rowsToParams(
        [
          { field: "gone", op: "eq", value: "x" },
          { field: "name", op: "eq", value: "" },
        ],
        FIELDS
      )
    ).toEqual({})
  })

  it("collects metadata rows per key and skips rows without a property", () => {
    expect(
      rowsToParams(
        [
          { field: "metadata", property: "floor", op: "gte", value: "2" },
          { field: "metadata", op: "eq", value: "orphan" },
          { field: "metadata", property: "customer->name", op: "seq", value: "Ann" },
          { field: "protected_metadata", property: "vip", op: "eq", value: "true" },
          { field: "metadata", property: "floor", op: "gte", value: "3" },
        ],
        FIELDS
      )
    ).toEqual({
      metadata: [
        { property: "floor", operator: "gte", value: "2" },
        { property: "customer->name", operator: "seq", value: "Ann" },
        { property: "floor", operator: "gte", value: "3" },
      ],
      protected_metadata: [{ property: "vip", operator: "eq", value: "true" }],
    })
  })
})

describe("parseAsFilterRows", () => {
  const rows: FilterRow[] = [
    { field: "name", op: "eq", value: "Studio" },
    { field: "metadata", property: "floor", op: "gte", value: "2" },
  ]

  it("round-trips rows through the URL", () => {
    const text = parseAsFilterRows.serialize(rows)
    expect(JSON.parse(text)).toEqual(rows)
    expect(parseAsFilterRows.parse(text)).toEqual(rows)
  })

  it("returns null for invalid JSON and for JSON that isn't an array", () => {
    expect(parseAsFilterRows.parse("{not json")).toBeNull()
    expect(parseAsFilterRows.parse('{"field":"name"}')).toBeNull()
    expect(parseAsFilterRows.parse("null")).toBeNull()
  })

  it("drops malformed rows and keeps the valid ones", () => {
    const text = JSON.stringify([
      rows[0],
      null,
      "row",
      { field: "name", op: "eq" },
      { field: "name", op: "eq", value: 5 },
      { field: 1, op: "eq", value: "x" },
      rows[1],
    ])
    expect(parseAsFilterRows.parse(text)).toEqual(rows)
  })

  it("accepts an empty array", () => {
    expect(parseAsFilterRows.parse("[]")).toEqual([])
  })
})
