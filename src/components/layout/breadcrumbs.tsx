"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

const SEGMENT_LABELS: Record<string, string> = {
  bookings: "Bookings",
  "booking-groups": "Booking groups",
  locations: "Locations",
  resources: "Resources",
  services: "Services",
  project: "Project",
  new: "New",
}

type Labels = Record<string, string>
const BreadcrumbContext = createContext<{
  labels: Labels
  setLabel: (segment: string, label: string | null) => void
} | null>(null)

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<Labels>({})
  const setLabel = useCallback((segment: string, label: string | null) =>
    setLabels((prev) => {
      if (label === null) {
        const next = { ...prev }
        delete next[segment]
        return next
      }
      return prev[segment] === label ? prev : { ...prev, [segment]: label }
    }), [])
  const value = useMemo(() => ({ labels, setLabel }), [labels, setLabel])
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>
}

/** Detail pages call this so the breadcrumb shows a name instead of a UUID. */
export function useBreadcrumbLabel(segment: string | undefined, label: string | undefined) {
  const ctx = useContext(BreadcrumbContext)
  const setLabel = ctx?.setLabel
  useEffect(() => {
    if (!setLabel || !segment || !label) return
    setLabel(segment, label)
  }, [setLabel, segment, label])
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i

export function Breadcrumbs() {
  const pathname = usePathname()
  const ctx = useContext(BreadcrumbContext)
  const segments = pathname.split("/").filter(Boolean)

  const crumbs = [
    { href: "/", label: "Dashboard" },
    ...segments.map((segment, i) => ({
      href: `/${segments.slice(0, i + 1).join("/")}`,
      label:
        ctx?.labels[segment] ??
        SEGMENT_LABELS[segment] ??
        (UUID_RE.test(segment) ? `${segment.slice(0, 8)}…` : segment),
    })),
  ]
  const visible = segments.length === 0 ? crumbs : crumbs.slice(1)

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {visible.map((crumb, i) => (
          <Fragment key={crumb.href}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="max-w-48 truncate">
              {i === visible.length - 1 ? (
                <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
