import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { formatTokens } from '@/components/stats/usage-formatters'
import { sessionUsageForWorker, type OrchestrationStatusRow } from './orchestration-status-rows'
import type { OrchestrationUsageCollection } from './orchestration-status-usage'

const STATE_TONE: Record<OrchestrationStatusRow['state'], string> = {
  pending: 'bg-muted-foreground/40',
  working: 'bg-foreground/70',
  blocked: 'bg-destructive',
  waiting: 'bg-muted-foreground',
  done: 'bg-muted-foreground/60',
  failed: 'bg-destructive',
  unverifiable: 'bg-muted-foreground/40'
}

function usageLabel(row: OrchestrationStatusRow, usage: OrchestrationUsageCollection): string {
  const measured = sessionUsageForWorker(row, usage.sessions)
  if (measured) {
    return translate('components.orchestration-status.tokens', '{{value0}} tokens', {
      value0: measured.totalTokens.toLocaleString()
    })
  }
  if (row.connectionId || row.isRemote) {
    return translate('components.orchestration-status.remote', 'Remote usage unavailable')
  }
  if (row.provider && !['claude', 'codex', 'opencode'].includes(row.provider)) {
    return translate('components.orchestration-status.unsupported', 'Usage unsupported')
  }
  if (row.provider && usage.availability[row.provider] === 'disabled') {
    return translate('components.orchestration-status.disabled', 'Collection off')
  }
  if (row.provider && usage.availability[row.provider] === 'unavailable') {
    return translate('components.orchestration-status.unavailable', 'Usage unavailable')
  }
  return translate('components.orchestration-status.pending', 'Awaiting usage')
}

function workerStateLabel(state: OrchestrationStatusRow['state']): string {
  switch (state) {
    case 'pending':
      return translate('components.orchestration-status.state.pending', 'Pending')
    case 'working':
      return translate('components.orchestration-status.state.working', 'Working')
    case 'blocked':
      return translate('components.orchestration-status.state.blocked', 'Needs input')
    case 'waiting':
      return translate('components.orchestration-status.state.waiting', 'Waiting')
    case 'done':
      return translate('components.orchestration-status.state.done', 'Response complete')
    case 'failed':
      return translate('components.orchestration-status.state.failed', 'Failed')
    case 'unverifiable':
      return translate('components.orchestration-status.state.unverifiable', 'Unverifiable')
  }
}

export function OrchestrationStatusRoster({
  rows,
  usage,
  controls,
  onEnableUsage,
  enablingProvider
}: {
  rows: readonly OrchestrationStatusRow[]
  usage: OrchestrationUsageCollection
  controls?: ReactNode
  onEnableUsage?: (provider: string) => void
  enablingProvider?: string | null
}): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  const listId = useId()
  if (rows.length === 0 && !controls) {
    return null
  }
  return (
    <section
      className="mt-2 shrink-0 border-t border-border pt-1 text-xs"
      data-orchestration-status-panel
    >
      {controls}
      {rows.length ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="w-full justify-start"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-3.5 transition-transform motion-reduce:transition-none',
                !open && '-rotate-90'
              )}
            />
            <span>
              {rows.length === 1
                ? translate('components.orchestration-status.worker', '1 worker')
                : translate('components.orchestration-status.workers', '{{count}} workers', {
                    count: rows.length
                  })}
            </span>
            <span className="ml-auto text-muted-foreground">
              {translate('components.orchestration-status.scope', 'Session totals')}
            </span>
          </Button>
          {open ? (
            <ul id={listId} className="max-h-40 overflow-y-auto scrollbar-sleek py-1">
              {rows.map((row) => {
                const measured = sessionUsageForWorker(row, usage.sessions)
                const model = row.model || measured?.model
                return (
                  <li
                    key={row.dispatchId}
                    className="flex min-w-0 items-center gap-2 px-2 py-1"
                    data-worker-state={row.state}
                  >
                    <span
                      role="img"
                      aria-label={workerStateLabel(row.state)}
                      className={cn('size-1.5 shrink-0 rounded-full', STATE_TONE[row.state])}
                    />
                    <span
                      className="w-32 min-w-0 shrink truncate font-mono text-muted-foreground sm:w-48"
                      title={
                        row.model ||
                        (model
                          ? translate(
                              'components.orchestration-status.recordModel',
                              'Model from this session record: {{model}}',
                              { model }
                            )
                          : undefined)
                      }
                    >
                      {model ||
                        translate('components.orchestration-status.modelUnknown', 'Model unknown')}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={row.task}>
                      {row.task}
                    </span>
                    {onEnableUsage &&
                    row.provider &&
                    !row.connectionId &&
                    !row.isRemote &&
                    usage.availability[row.provider] === 'disabled' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={Boolean(enablingProvider)}
                        onClick={() => onEnableUsage(row.provider!)}
                      >
                        {translate(
                          'components.orchestration-status.enableUsage',
                          'Enable usage collection'
                        )}
                      </Button>
                    ) : (
                      <span
                        className="flex shrink-0 flex-col items-end font-mono text-muted-foreground tabular-nums"
                        title={measured ? measured.totalTokens.toLocaleString() : undefined}
                      >
                        <span>{usageLabel(row, usage)}</span>
                        {measured && measured.totalTokens >= 1000 ? (
                          <span>
                            {translate('components.orchestration-status.tokens', '{{value0}} tokens', {
                              value0: formatTokens(measured.totalTokens)
                            })}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
