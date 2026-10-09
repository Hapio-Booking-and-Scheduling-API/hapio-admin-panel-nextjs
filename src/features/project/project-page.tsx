"use client"

import { ExternalLinkIcon, KeyRoundIcon, WebhookIcon } from "lucide-react"
import { useSyncExternalStore } from "react"

import { EnabledBadge } from "@/components/entity/badges"
import { CopyId } from "@/components/entity/copy-id"
import { DetailList } from "@/components/entity/detail-list"
import { ErrorAlert } from "@/components/entity/error-alert"
import { PageHeader } from "@/components/entity/page-header"
import { SectionCard } from "@/components/entity/section-card"
import { DetailSkeleton } from "@/components/entity/skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDateTime } from "@/lib/format/datetime"
import { isHapioError } from "@/lib/hapio/errors"
import { useProject } from "@/lib/hapio/hooks"
import { getRateLimit, getServerRateLimit, subscribeRateLimit } from "@/lib/hapio/rate-limit"

const WEBHOOK_EVENTS: Record<string, string[]> = {
  booking: ["created", "updated", "deleted", "finalized", "canceled", "reminder"],
  booking_group: ["created", "updated", "deleted"],
  location: ["created", "updated", "deleted"],
  resource: ["created", "updated", "deleted"],
  service: ["created", "updated", "deleted"],
  resource_service: ["created", "deleted"],
  schedule_block: ["created", "updated", "deleted"],
  recurring_schedule: ["created", "updated", "deleted"],
  recurring_schedule_block: ["created", "updated", "deleted"],
}

const PORTAL_URL = "https://hapio.app"

export function ProjectPage() {
  const project = useProject()
  const rateLimit = useSyncExternalStore(subscribeRateLimit, getRateLimit, getServerRateLimit)

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Project"
        description="The Hapio project your API token belongs to."
        actions={
          <Button variant="outline" asChild>
            <a href={PORTAL_URL} target="_blank" rel="noreferrer">
              Open Hapio portal <ExternalLinkIcon />
            </a>
          </Button>
        }
      />
      {project.isLoading ? (
        <DetailSkeleton />
      ) : project.error ? (
        isHapioError(project.error) && project.error.status === 404 ? (
          <ErrorAlert
            error={project.error}
            title="This token isn't tied to a project"
            onRetry={() => project.refetch()}
          />
        ) : (
          <ErrorAlert error={project.error} onRetry={() => project.refetch()} />
        )
      ) : project.data ? (
        <SectionCard title={project.data.name} action={<EnabledBadge enabled={project.data.enabled} />}>
          <DetailList
            items={[
              { label: "Project ID", value: <CopyId id={project.data.id} /> },
              { label: "Created", value: formatDateTime(project.data.created_at, { withOffset: true }) },
              { label: "Updated", value: formatDateTime(project.data.updated_at, { withOffset: true }) },
              {
                label: "Rate limit",
                value:
                  rateLimit.limit !== null
                    ? `${rateLimit.remaining} of ${rateLimit.limit} requests left this minute`
                    : "Not reported yet",
              },
            ]}
          />
        </SectionCard>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <KeyRoundIcon className="size-4" /> API tokens
            </span>
          }
          description="Managed in the Hapio portal; the API can't create or revoke tokens."
        >
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              This panel uses the token in <code>HAPIO_API_TOKEN</code> on the server. Each action needs the matching
              ability on that token, for example <code>booking:create</code> or{" "}
              <code>booking:ignore_schedule</code>. A 403 error means the token is missing an ability.
            </p>
            <p>
              Protected metadata is only returned and editable with <code>&lt;entity&gt;:protected_metadata</code>.
            </p>
          </div>
        </SectionCard>
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <WebhookIcon className="size-4" /> Webhooks
            </span>
          }
          description="Configured in the Hapio portal. These events can be sent:"
        >
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(WEBHOOK_EVENTS).flatMap(([entity, events]) =>
                events.map((event) => (
                  <Badge key={`${entity}.${event}`} variant="outline" className="font-mono text-[11px]">
                    {entity}.{event}
                  </Badge>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Payloads are <code>{"{ event, timestamp, subject_url }"}</code>, signed with HMAC-SHA256 in{" "}
              <code>X-Hapio-Signature</code> over <code>{"{timestamp}.{body}"}</code>. Failed deliveries are retried every
              15 minutes for up to 24 hours.
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
