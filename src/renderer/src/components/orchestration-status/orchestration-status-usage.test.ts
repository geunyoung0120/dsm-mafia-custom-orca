import { describe, expect, it, vi } from 'vitest'
import { loadOrchestrationUsage, type UsageSourceRow } from './orchestration-status-usage'

function api(rows: (UsageSourceRow & { cachedInputTokens?: number })[], enabled = true) {
  return {
    getScanState: vi.fn(async () => ({ enabled })),
    refresh: vi.fn(async () => undefined),
    getRecentSessions: vi.fn(async () => rows)
  }
}
describe('existing usage providers', () => {
  it('counts Claude cache reads and writes, and uses Codex canonical totals without adding caches twice', async () => {
    const claude = api([
      {
        sessionId: 'a',
        model: 'claude-test',
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheWriteTokens: 30
      }
    ])
    const codex = api([
      {
        sessionId: 'b',
        model: 'gpt-test',
        inputTokens: 100,
        cachedInputTokens: 50,
        outputTokens: 20,
        totalTokens: 120
      }
    ])
    const result = await loadOrchestrationUsage(
      [
        { provider: 'claude', sessionId: 'a' },
        { provider: 'codex', sessionId: 'b' }
      ],
      { claude, codex }
    )
    expect(result.sessions.map((row) => row.totalTokens)).toEqual([200, 120])
    expect(codex.getRecentSessions).toHaveBeenCalledWith({
      scope: 'all',
      range: 'all',
      limit: 1000
    })
  })
  it('does not turn on collection that the user disabled', async () => {
    const claude = api([], false)
    const result = await loadOrchestrationUsage([{ provider: 'claude', sessionId: 'a' }], {
      claude
    })
    expect(result.availability.claude).toBe('disabled')
    expect(claude.refresh).not.toHaveBeenCalled()
    expect(claude.getRecentSessions).not.toHaveBeenCalled()
  })
  it('filters exact sessions and scans each requested provider once', async () => {
    const codex = api([
      { sessionId: 'a', model: null, totalTokens: 10 },
      { sessionId: 'unrelated', model: null, totalTokens: 999 }
    ])
    const result = await loadOrchestrationUsage(
      [
        { provider: 'codex', sessionId: 'a' },
        { provider: 'codex', sessionId: 'a' }
      ],
      { codex }
    )
    expect(result.sessions).toHaveLength(1)
    expect(codex.refresh).toHaveBeenCalledTimes(1)
    expect(codex.refresh).toHaveBeenCalledWith({ force: true })
  })
  it('isolates failed providers without discarding the others', async () => {
    const codex = api([{ sessionId: 'b', totalTokens: 10 }])
    const claude = api([])
    claude.refresh.mockRejectedValue(new Error('offline'))
    const result = await loadOrchestrationUsage(
      [
        { provider: 'claude', sessionId: 'a' },
        { provider: 'codex', sessionId: 'b' }
      ],
      { claude, codex }
    )
    expect(result.availability.claude).toBe('unavailable')
    expect(result.sessions[0].totalTokens).toBe(10)
  })
  it('does not query unsupported providers or missing APIs', async () => {
    const result = await loadOrchestrationUsage(
      [
        { provider: 'other', sessionId: 'a' },
        { provider: 'codex', sessionId: 'b' }
      ],
      {}
    )
    expect(result.sessions).toEqual([])
    expect(result.availability.codex).toBe('unavailable')
  })
  it('does not convert a missing Claude measurement into zero tokens', async () => {
    const claude = api([{ sessionId: 'a', model: null }])
    const result = await loadOrchestrationUsage([{ provider: 'claude', sessionId: 'a' }], {
      claude
    })
    expect(result.sessions).toEqual([])
  })
  it('does not present a cached total as current after a host scan failed', async () => {
    const codex = {
      ...api([{ sessionId: 'a', totalTokens: 99 }]),
      refresh: vi.fn(async () => ({ lastScanError: 'source unreadable' }))
    }
    const result = await loadOrchestrationUsage([{ provider: 'codex', sessionId: 'a' }], { codex })
    expect(result.availability.codex).toBe('unavailable')
    expect(result.sessions).toEqual([])
    expect(codex.getRecentSessions).not.toHaveBeenCalled()
  })
})
