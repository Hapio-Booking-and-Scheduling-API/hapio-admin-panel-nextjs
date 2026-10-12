"use client"

import {
  BoxesIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  MapPinIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense } from "react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { useProject } from "@/lib/hapio/hooks"

import { HapioLogo } from "./hapio-logo"

const NAV = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", href: "/", icon: LayoutDashboardIcon }],
  },
  {
    label: "Bookings",
    items: [
      { title: "Calendar", href: "/calendar", icon: CalendarDaysIcon },
      { title: "Bookings", href: "/bookings", icon: CalendarCheckIcon },
      { title: "Booking groups", href: "/booking-groups", icon: BoxesIcon },
    ],
  },
  {
    label: "Setup",
    items: [
      { title: "Locations", href: "/locations", icon: MapPinIcon },
      { title: "Resources", href: "/resources", icon: UsersIcon },
      { title: "Services", href: "/services", icon: SparklesIcon },
    ],
  },
  {
    label: "Account",
    items: [{ title: "Project", href: "/project", icon: FolderKanbanIcon }],
  },
]

function ProjectName() {
  const project = useProject()
  return <>{project.data?.name ?? "Booking API"}</>
}

type NavItem = (typeof NAV)[number]["items"][number]

function NavButton({ item, active }: { item: NavItem; active: boolean }) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
      <Link href={item.href} onClick={() => setOpenMobile(false)}>
        <item.icon />
        <span>{item.title}</span>
      </Link>
    </SidebarMenuButton>
  )
}

// usePathname() is request data on dynamic routes, so only the active-state
// lookup waits behind Suspense; the links themselves are part of the static shell.
function ActiveNavButton({ item }: { item: NavItem }) {
  const pathname = usePathname()
  const active =
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`)
  return <NavButton item={item} active={active} />
}

export function AppSidebar() {
  const { setOpenMobile } = useSidebar()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/" onClick={() => setOpenMobile(false)}>
                <div className="flex aspect-square size-8 items-center justify-center text-sidebar-foreground">
                  <HapioLogo className="size-7!" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Hapio Admin</span>
                  <span className="truncate text-xs text-muted-foreground">
                    <Suspense fallback="Booking API">
                      <ProjectName />
                    </Suspense>
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <Suspense fallback={<NavButton item={item} active={false} />}>
                      <ActiveNavButton item={item} />
                    </Suspense>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          Hapio API v1
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
