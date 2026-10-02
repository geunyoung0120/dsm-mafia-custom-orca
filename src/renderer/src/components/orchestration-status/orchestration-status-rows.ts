import {
  isFreshNonDoneAgentStatus,
  type AgentStatusEntry,
  type AgentStatusOrchestrationContext
} from '../../../../shared/agent-status-types'
import {
  getTabIdFromPaneKey,
  isRecentlyClosedAgentStatusTab
} from '@/store/slices/agent-status-pane-key-tab-binding'

export type OrchestrationStatusRow = {
  paneKey: string
  dispatchId: string
  task: string
  provider: string | null
  model: string | null
  sessionId: string | null
  connectionId: string | null
  isRemote?: boolean
  state: 'pending' | 'working' | 'blocked' | 'waiting' | 'done' | 'failed' | 'unverifiable'
}

export type OrchestrationSessionUsage = {
  provider: string
  sessionId: string
  model: string | null
  totalTokens: number
}

type RosterSource = {
  parentPaneKey: string
  runId?: string | null
  live: Record<string, AgentStatusEntry>
  retained: Record<string, { entry: AgentStatusEntry }>
  contexts: Record<string, AgentStatusOrchestrationContext>
  closedTabs?: Record<string, true>
  retiredPanes?: Record<string, true | string>
  openTabIds?: ReadonlySet<string>
  now?: number
}

function isRemovedWorker(
  source: Pick<RosterSource, 'closedTabs' | 'retiredPanes' | 'openTabIds'>,
  paneKey: string,
  context: AgentStatusOrchestrationContext
): boolean {
  const tabId = getTabIdFromPaneKey(paneKey)
  if (
    source.retiredPanes?.[paneKey] ||
    isRecentlyClosedAgentStatusTab(source.closedTabs ?? {}, tabId)
  ) {
    return true
  }
  const settled = ['completed', 'failed', 'circuit_broken'].includes(context.dispatchStatus ?? '')
  // A missing local tab is not proof that remote active work exited.
  return Boolean(settled && tabId && source.openTabIds && !source.openTabIds.has(tabId))
}

function workerState(
  context: AgentStatusOrchestrationContext,
  entry: AgentStatusEntry | undefined,
  now: number
): OrchestrationStatusRow['state'] {
  switch (context.dispatchStatus) {
    case 'pending':
      return 'pending'
    case 'completed':
      return 'done'
    case 'failed':
    case 'circuit_broken':
      return 'failed'
    case 'dispatched':
    case undefined:
      break
  }
  if (!entry || (entry.state !== 'done' && !isFreshNonDoneAgentStatus(entry, now))) {
    return 'unverifiable'
  }
  return entry.state
}

/** The runtime owns dispatch identity; an old hook on a reused pane cannot supply its model or usage. */
export function buildOrchestrationStatusRows(source: RosterSource): OrchestrationStatusRow[] {
  const entries = new Map<string, AgentStatusEntry>()
  for (const [key, retained] of Object.entries(source.retained)) {
    entries.set(key, retained.entry)
  }
  for (const [key, entry] of Object.entries(source.live)) {
    entries.set(key, entry)
  }
  const contexts = new Map<string, AgentStatusOrchestrationContext>()
  for (const [key, entry] of entries) {
    if (entry.orchestration) {
      contexts.set(key, entry.orchestration)
    }
  }
  for (const [key, context] of Object.entries(source.contexts)) {
    contexts.set(key, context)
  }
  const handleOwners = new Map<string, string | null>()
  for (const [key, entry] of entries) {
    if (!entry.terminalHandle) {
      continue
    }
    handleOwners.set(entry.terminalHandle, handleOwners.has(entry.terminalHandle) ? null : key)
  }
  const children = new Map<string, string[]>()
  for (const [key, context] of contexts) {
    const parent = source.runId
      ? context.orchestrationRunId === source.runId
        ? source.parentPaneKey
        : null
      : (context.parentPaneKey ??
        (context.parentTerminalHandle ? handleOwners.get(context.parentTerminalHandle) : null))
    if (!parent) {
      continue
    }
    const siblings = children.get(parent) ?? []
    siblings.push(key)
    children.set(parent, siblings)
  }
  const seen = new Set([source.parentPaneKey])
  const queue = [source.parentPaneKey]
  const rows: OrchestrationStatusRow[] = []
  const now = source.now ?? Date.now()
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const paneKey of children.get(queue[cursor]) ?? []) {
      if (seen.has(paneKey)) {
        continue
      }
      seen.add(paneKey)
      queue.push(paneKey)
      const context = contexts.get(paneKey)!
      if (isRemovedWorker(source, paneKey, context)) {
        continue
      }
      const observed = entries.get(paneKey)
      const sameDispatch =
        !observed?.orchestration || observed.orchestration.dispatchId === context.dispatchId
      const entry = sameDispatch ? observed : undefined
      rows.push({
        paneKey,
        dispatchId: context.dispatchId,
        task:
          context.taskTitle?.trim() ||
          context.displayName?.trim() ||
          entry?.prompt.trim() ||
          context.taskId,
        provider: entry?.agentType ?? null,
        model: entry?.model ?? null,
        sessionId: entry?.providerSession?.id ?? null,
        connectionId: entry?.connectionId ?? null,
        isRemote: Boolean(entry?.connectionId || entry?.mirroredEvidenceReceivedAt !== undefined),
        state: workerState(context, entry, now)
      })
    }
  }
  return rows
}

export function orchestrationRunOptions(
  source: Pick<
    RosterSource,
    'live' | 'retained' | 'contexts' | 'closedTabs' | 'retiredPanes' | 'openTabIds'
  >
): { id: string; label: string }[] {
  const contexts = new Map<string, AgentStatusOrchestrationContext>()
  for (const [key, retained] of Object.entries(source.retained)) {
    if (retained.entry.orchestration) {
      contexts.set(key, retained.entry.orchestration)
    }
  }
  for (const [key, entry] of Object.entries(source.live)) {
    if (entry.orchestration) {
      contexts.set(key, entry.orchestration)
    }
  }
  for (const [key, context] of Object.entries(source.contexts)) {
    contexts.set(key, context)
  }
  const runs = new Map<string, string>()
  for (const [paneKey, context] of contexts) {
    if (context.orchestrationRunId && !isRemovedWorker(source, paneKey, context)) {
      runs.set(
        context.orchestrationRunId,
        context.taskTitle?.trim() || context.displayName?.trim() || context.taskId
      )
    }
  }
  return [...runs].map(([id, label]) => ({ id, label }))
}

export function sessionUsageForWorker(
  row: OrchestrationStatusRow,
  usage: readonly OrchestrationSessionUsage[]
): OrchestrationSessionUsage | null {
  if (row.connectionId || row.isRemote || !row.provider || !row.sessionId) {
    return null
  }
  const match = usage.find(
    (item) => item.provider === row.provider && item.sessionId === row.sessionId
  )
  return match && Number.isFinite(match.totalTokens) && match.totalTokens >= 0 ? match : null
}
