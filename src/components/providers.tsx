"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { NuqsAdapter } from "nuqs/adapters/next/app"
import { useState } from "react"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { isHapioError } from "@/lib/hapio/errors"

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Hapio rate-limits per minute; don't refetch on every focus.
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (isHapioError(error)) {
            if (error.status === 429) return failureCount < 3
            if (error.status >= 500 && !error.isNotConfigured) return failureCount < 1
            return false
          }
          return failureCount < 1
        },
        retryDelay: (attempt, error) =>
          isHapioError(error) && error.retryAfter
            ? error.retryAfter * 1000
            : Math.min(1000 * 2 ** attempt, 10_000),
      },
    },
  })
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster richColors closeButton position="bottom-right" />
          </TooltipProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
