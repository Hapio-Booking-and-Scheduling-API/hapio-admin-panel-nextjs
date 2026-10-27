// Hidden sections (NEXT_PUBLIC_ADMIN_HIDDEN) are left out of the sidebar, and
// their pages answer "not found", so a bookmark can't reach them either.

import { NextResponse, type NextRequest } from "next/server"

import { isShown, type Section } from "@/lib/admin-config"

export function sectionOf(pathname: string): Section {
  return (pathname.split("/")[1] || "dashboard") as Section
}

export function proxy(request: NextRequest) {
  if (isShown(sectionOf(request.nextUrl.pathname))) return NextResponse.next()

  // An address with no page renders the app's own "not found" page
  return NextResponse.rewrite(new URL("/_hidden", request.url))
}

export const config = {
  matcher: [
    "/",
    "/calendar/:path*",
    "/bookings/:path*",
    "/booking-groups/:path*",
    "/locations/:path*",
    "/resources/:path*",
    "/services/:path*",
    "/project/:path*",
  ],
}
