"use client"

import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  InboxIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { cn } from "cn"

import { ErrorAlert } from "@/components/entity/error-alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { PaginationMeta } from "@/lib/hapio/types"

import { PER_PAGE_OPTIONS } from "./use-list-state"

export interface Column<T> {
  id: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  /** Hapio sort field, e.g. "name" → "name.asc" / "name.desc". */
  sortKey?: string
  className?: string
}

export interface PaginationState {
  page: number
  perPage: number
  onPageChange: (page: number) => void
  onPerPageChange: (perPage: number) => void
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[] | undefined
  getRowId: (row: T) => string
  isLoading?: boolean
  isFetching?: boolean
  error?: unknown
  onRetry?: () => void
  meta?: PaginationMeta
  pagination?: PaginationState
  sort?: string
  onSortChange?: (sort: string) => void
  rowHref?: (row: T) => string
  rowClassName?: (row: T) => string | undefined
  emptyTitle?: string
  emptyDescription?: React.ReactNode
  emptyAction?: React.ReactNode
}

function SortIcon({ direction }: { direction: "asc" | "desc" | null }) {
  if (direction === "asc") return <ArrowUpIcon />
  if (direction === "desc") return <ArrowDownIcon />
  return <ArrowUpDownIcon className="opacity-40" />
}

const INTERACTIVE = "a,button,input,select,textarea,label,[role=menuitem],[role=checkbox],[data-no-row-click]"

export function DataTable<T>({
  columns,
  data,
  getRowId,
  isLoading,
  isFetching,
  error,
  onRetry,
  meta,
  pagination,
  sort,
  onSortChange,
  rowHref,
  rowClassName,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
}: DataTableProps<T>) {
  const router = useRouter()
  const [sortField, sortDir] = (sort ?? "").split(",")[0].split(".") as [string, "asc" | "desc" | undefined]

  const toggleSort = (key: string) => {
    if (!onSortChange) return
    if (sortField !== key) onSortChange(`${key}.asc`)
    else if (sortDir === "asc") onSortChange(`${key}.desc`)
    else onSortChange("")
  }

  if (error && !data) {
    return <ErrorAlert error={error} onRetry={onRetry} />
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "overflow-hidden rounded-lg border transition-opacity",
          isFetching && !isLoading && "opacity-70"
        )}
      >
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.id} className={column.className}>
                  {column.sortKey && onSortChange ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2.5 h-7"
                      onClick={() => toggleSort(column.sortKey!)}
                    >
                      {column.header}
                      <SortIcon direction={sortField === column.sortKey ? sortDir ?? null : null} />
                    </Button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && !data
              ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((column) => (
                      <TableCell key={column.id} className={column.className}>
                        <Skeleton className="h-4 w-full max-w-40" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data?.map((row) => (
                  <TableRow
                    key={getRowId(row)}
                    className={cn(rowHref && "cursor-pointer", rowClassName?.(row))}
                    onClick={(event) => {
                      if (!rowHref) return
                      if ((event.target as HTMLElement).closest(INTERACTIVE)) return
                      const href = rowHref(row)
                      if (event.metaKey || event.ctrlKey) window.open(href, "_blank")
                      else router.push(href)
                    }}
                  >
                    {columns.map((column) => (
                      <TableCell key={column.id} className={column.className}>
                        {column.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
        {!isLoading && data?.length === 0 && (
          <Empty className="rounded-none border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              {emptyDescription && <EmptyDescription>{emptyDescription}</EmptyDescription>}
            </EmptyHeader>
            {emptyAction}
          </Empty>
        )}
      </div>
      {pagination && meta && <DataTablePagination meta={meta} pagination={pagination} />}
    </div>
  )
}

export function DataTablePagination({
  meta,
  pagination,
}: {
  meta: PaginationMeta
  pagination: PaginationState
}) {
  const { page, perPage, onPageChange, onPerPageChange } = pagination
  const last = Math.max(1, meta.last_page)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span className="tabular-nums">
        {meta.total === 0 ? "No results" : `${meta.from ?? 0}–${meta.to ?? 0} of ${meta.total}`}
      </span>
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline">Rows</span>
        <Select value={String(perPage)} onValueChange={(v) => onPerPageChange(Number(v))}>
          <SelectTrigger size="sm" className="w-18" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PER_PAGE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="tabular-nums">
          Page {Math.min(page, last)} of {last}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(1)} aria-label="First page">
            <ChevronsLeftIcon />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={page >= last} onClick={() => onPageChange(page + 1)} aria-label="Next page">
            <ChevronRightIcon />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={page >= last} onClick={() => onPageChange(last)} aria-label="Last page">
            <ChevronsRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
