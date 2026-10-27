import { InfoIcon } from "lucide-react"

import { adminConfig } from "@/lib/admin-config"

/** A slim notice above every page, like "Staging" or a maintenance window (NEXT_PUBLIC_ADMIN_BANNER_*). */
export function AdminBanner() {
  const { banner } = adminConfig
  if (!banner) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-primary px-4 py-2 text-center text-sm text-primary-foreground"
    >
      <span className="flex items-center gap-2">
        <InfoIcon className="size-4 shrink-0" aria-hidden />
        {banner.text}
      </span>
      {banner.link ? (
        <a className="font-medium underline underline-offset-4" href={banner.link} target="_blank" rel="noopener">
          {banner.linkText ?? banner.link}
        </a>
      ) : null}
    </div>
  )
}
