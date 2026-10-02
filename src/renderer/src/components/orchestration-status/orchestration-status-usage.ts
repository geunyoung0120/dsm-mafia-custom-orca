import type { OrchestrationSessionUsage } from './orchestration-status-rows'

export type UsageSourceRow = {
  sessionId: string
  model?: string | null
  totalTokens?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}
type UsageApi = {
  getScanState: () => Promise<{ enabled: boolean } | undefined>
  refresh: (args?: { force?: boolean }) => Promise<{ lastScanError?: string | null } | undefined>
  getRecentSessions: (args: {
    scope: 'all'
    range: 'all'
    limit: number
  }) => Promise<UsageSourceRow[] | undefined>
}
export type OrchestrationUsageApis = Partial<Record<string, UsageApi>>
export type OrchestrationUsageTarget = { provider: string; sessionId: string }
export type OrchestrationUsageCollection = {
  sessions: OrchestrationSessionUsage[]
  availability: Partial<Record<string, 'ready' | 'disabled' | 'unavailable'>>
}
export const EMPTY_ORCHESTRATION_USAGE: OrchestrationUsageCollection = {
  sessions: [],
  availability: {}
}
const SUPPORTED_PROVIDERS = ['claude', 'codex', 'opencode'] as const

export async function loadOrchestrationUsage(
  targets: readonly OrchestrationUsageTarget[],
  apis: OrchestrationUsageApis
): Promise<OrchestrationUsageCollection> {
  const result: OrchestrationUsageCollection = { sessions: [], availability: {} }
  await Promise.all(
    SUPPORTED_PROVIDERS.map(async (provider) => {
      const ids = new Set(
        targets.filter((target) => target.provider === provider).map((target) => target.sessionId)
      )
      if (ids.size === 0) {
        return
      }
      const api = apis[provider]
      try {
        const scan = await api?.getScanState()
        if (!api || !scan) {
          result.availability[provider] = 'unavailable'
          return
        }
        if (!scan.enabled) {
          result.availability[provider] = 'disabled'
          return
        }
        // Visible worker tokens must not inherit the statistics screen's five-minute cache.
        // The host shares concurrent scans and reuses unchanged source-file projections.
        const refreshed = await api.refresh({ force: true })
        if (refreshed?.lastScanError) {
          result.availability[provider] = 'unavailable'
          return
        }
        const sessions = await api.getRecentSessions({ scope: 'all', range: 'all', limit: 1000 })
        if (!sessions) {
          result.availability[provider] = 'unavailable'
          return
        }
        result.availability[provider] = 'ready'
        for (const session of sessions) {
          if (!ids.has(session.sessionId)) {
            continue
          }
          if (
            provider === 'claude' &&
            ![
              session.inputTokens,
              session.outputTokens,
              session.cacheReadTokens,
              session.cacheWriteTokens
            ].every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
          ) {
            continue
          }
          // Codex's cached input and reasoning output are subsets of its canonical total.
          const totalTokens =
            provider === 'claude'
              ? (session.inputTokens ?? 0) +
                (session.outputTokens ?? 0) +
                (session.cacheReadTokens ?? 0) +
                (session.cacheWriteTokens ?? 0)
              : session.totalTokens
          if (typeof totalTokens !== 'number' || !Number.isFinite(totalTokens) || totalTokens < 0) {
            continue
          }
          result.sessions.push({
            provider,
            sessionId: session.sessionId,
            model: session.model ?? null,
            totalTokens
          })
        }
      } catch {
        result.availability[provider] = 'unavailable'
      }
    })
  )
  return result
}
