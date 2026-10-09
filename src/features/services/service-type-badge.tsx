import { CalendarDaysIcon, MoveHorizontalIcon, TimerIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { ServiceType } from "@/lib/hapio/types"

import { serviceTypeLabel } from "./utils"

export const SERVICE_TYPE_ICONS: Record<ServiceType, React.ComponentType<{ className?: string }>> = {
  fixed: TimerIcon,
  flexible: MoveHorizontalIcon,
  day: CalendarDaysIcon,
}

export function ServiceTypeBadge({ type }: { type: ServiceType }) {
  const Icon = SERVICE_TYPE_ICONS[type] ?? TimerIcon
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Icon />
      {serviceTypeLabel(type)}
    </Badge>
  )
}
