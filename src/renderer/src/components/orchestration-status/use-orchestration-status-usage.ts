import { useEffect, useState } from 'react'
import type { OrchestrationStatusRow } from './orchestration-status-rows'
import {
  EMPTY_ORCHESTRATION_USAGE,
  loadOrchestrationUsage,
  type OrchestrationUsageCollection
} from './orchestration-status-usage'

export function useOrchestrationStatusUsage(
  rows: readonly OrchestrationStatusRow[],
  enabled: boolean,
  refreshVersion = 0
): OrchestrationUsageCollection {
  // Provider session IDs reject control characters at ingestion; these separators are unambiguous.
  const targetKey = [
    ...new Set(
      rows
        .filter((row) => !row.connectionId && !row.isRemote && row.provider && row.sessionId)
        .map((row) => `${row.provider}\0${row.sessionId}`)
    )
  ]
    .sort()
    .join('\n')
  const [snapshot, setSnapshot] = useState({ key: '', data: EMPTY_ORCHESTRATION_USAGE })
  useEffect(() => {
    if (!enabled || !targetKey) {
      return
    }
    let disposed = false
    let inFlight = false
    const targets = targetKey.split('\n').map((key) => {
      const [provider, sessionId] = key.split('\0')
      return { provider, sessionId }
    })
    const poll = async (): Promise<void> => {
      if (inFlight || disposed) {
        return
      }
      inFlight = true
      const api = typeof window === 'undefined' ? undefined : window.api
      const data = await loadOrchestrationUsage(targets, {
        claude: api?.claudeUsage,
        codex: api?.codexUsage,
        opencode: api?.openCodeUsage
      }).finally(() => {
        inFlight = false
      })
      if (disposed) {
        return
      }
      setSnapshot({ key: targetKey, data })
    }
    void poll()
    const timer = setInterval(() => {
      void poll()
    }, 5000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [enabled, targetKey, refreshVersion])
  return snapshot.key === targetKey ? snapshot.data : EMPTY_ORCHESTRATION_USAGE
}
