import { Suspense } from "react"

import { AdminBanner } from "@/components/layout/admin-banner"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { BreadcrumbProvider } from "@/components/layout/breadcrumbs"
import { SetupBanner } from "@/components/layout/setup-banner"
import { SiteHeader } from "@/components/layout/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export default function AdminLayout({ children }: LayoutProps<"/">) {
  return (
    <BreadcrumbProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <AdminBanner />
          <SiteHeader />
          <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
            <Suspense>
              <SetupBanner />
            </Suspense>
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </BreadcrumbProvider>
  )
}
