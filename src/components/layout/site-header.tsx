"use client"

import { GaugeIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { Suspense, useSyncExternalStore } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getRateLimit, getServerRateLimit, subscribeRateLimit } from "@/lib/hapio/rate-limit"

import { Breadcrumbs } from "./breadcrumbs"

function RateLimitBadge() {
  const { limit, remaining } = useSyncExternalStore(
    subscribeRateLimit,
    getRateLimit,
    getServerRateLimit
  )
  if (limit === null || remaining === null) return null
  const low = remaining / Math.max(limit, 1) < 0.2
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={low ? "destructive" : "outline"} className="gap-1 tabular-nums">
          <GaugeIcon />
          {remaining}/{limit}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>API requests remaining this minute</TooltipContent>
    </Tooltip>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <SunIcon className="dark:hidden" />
          <MoonIcon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <SunIcon /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2" />
      <div className="min-w-0 flex-1">
        <Suspense fallback={<Skeleton className="h-4 w-40" />}>
          <Breadcrumbs />
        </Suspense>
      </div>
      <RateLimitBadge />
      <ThemeToggle />
    </header>
  )
}
