import type { ResourceSelectionStrategy } from "@/lib/hapio/types"

export const STRATEGY_LABELS: Record<ResourceSelectionStrategy, { label: string; description: string }> = {
  randomize: { label: "Randomize", description: "Pick a random available resource." },
  prioritize: {
    label: "Prioritize",
    description: "Pick resources in a fixed order; unlisted resources follow, sorted by ID.",
  },
  equalize: { label: "Equalize", description: "Spread bookings evenly across resources." },
}
