import { cn } from "cn"
import { Loader2Icon } from "lucide-react"

/**
 * Loading indicator. Standalone it announces "Loading"; inside a button pass
 * `aria-hidden` (and set `aria-busy` on the button) so the button keeps its name.
 */
function Spinner({ className, "aria-hidden": ariaHidden, ...props }: React.ComponentProps<"svg">) {
  const a11y = ariaHidden ? { "aria-hidden": true as const } : { role: "status", "aria-label": "Loading" }
  return <Loader2Icon data-slot="spinner" {...a11y} className={cn("size-4 animate-spin", className)} {...props} />
}

export { Spinner }
