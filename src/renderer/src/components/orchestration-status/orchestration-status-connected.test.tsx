// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationStatusPanel } from './OrchestrationStatusPanel'
import { useOrchestrationPanelScope } from './use-orchestration-panel-scope'

const source = vi.hoisted(() => {
  const retiredPanes: Record<string, true> = {}
  return {
    agentStatusByPaneKey: {
      worker: {
        paneKey: 'worker',
        state: 'working',
        prompt: 'Implementation',
        agentType: 'claude',
        updatedAt: Date.now(),
        stateStartedAt: Date.now(),
        stateHistory: [],
        providerSession: { key: 'session_id', id: 'exact-session' }
      }
    },
    retainedAgentsByPaneKey: {},
    runtimeAgentOrchestrationByPaneKey: {
      worker: {
        dispatchId: 'dispatch',
        taskId: 'task',
        taskTitle: 'Implement introduction',
        parentPaneKey: 'actual-coordinator',
        orchestrationRunId: 'selected-run'
      }
    },
    recentlyRetiredAgentStatusPaneKeys: retiredPanes,
    agentStatusEpoch: 0
  }
})
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof source) => unknown) => selector(source)
}))
let enabled = false
const usageApi = {
  getScanState: vi.fn(async () => ({ enabled })),
  setEnabled: vi.fn(async ({ enabled: next }: { enabled: boolean }) => {
    enabled = next
    return { enabled }
  }),
  refresh: vi.fn(async () => ({})),
  getRecentSessions: vi.fn(async () => [
    {
      sessionId: 'exact-session',
      model: 'claude-measured',
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheWriteTokens: 40
    }
  ])
}
beforeEach(() => {
  enabled = false
  vi.clearAllMocks()
  window.localStorage.clear()
  source.recentlyRetiredAgentStatusPaneKeys = {}
  Object.defineProperty(window, 'api', { configurable: true, value: { claudeUsage: usageApi } })
})
afterEach(cleanup)

describe('requesting pane status integration', () => {
  it('automatically shows host-projected workers in the requesting native chat without selecting a run', async () => {
    enabled = true
    render(<OrchestrationStatusPanel paneKey="actual-coordinator" />)
    await screen.findByText('100 tokens')
    expect(screen.getByText('Implement introduction')).toBeTruthy()
    expect(screen.getByText('claude-measured')).toBeTruthy()
    expect(window.localStorage.length).toBe(0)
  })
  it('removes the whole panel and run picker on terminal cleanup despite a replayed context', async () => {
    enabled = true
    window.localStorage.setItem('orca.orchestration-panel.run:requester', 'selected-run')
    const view = render(<OrchestrationStatusPanel paneKey="requester" />)
    await screen.findByText('100 tokens')
    source.recentlyRetiredAgentStatusPaneKeys = { worker: true }
    view.rerender(<OrchestrationStatusPanel paneKey="requester" />)
    expect(view.container.childElementCount).toBe(0)
    expect(source.runtimeAgentOrchestrationByPaneKey.worker.dispatchId).toBe('dispatch')
  })
  it('keeps view selections separate per pane and restores them after remount', () => {
    const first = renderHook(() => useOrchestrationPanelScope('requester'))
    const other = renderHook(() => useOrchestrationPanelScope('other'))
    act(() => first.result.current[1]('selected-run'))
    expect(first.result.current[0]).toBe('selected-run')
    expect(other.result.current[0]).toBeNull()
    first.unmount()
    const restored = renderHook(() => useOrchestrationPanelScope('requester'))
    expect(restored.result.current[0]).toBe('selected-run')
    act(() => restored.result.current[1](null))
    expect(restored.result.current[0]).toBeNull()
  })
  it('renders measured model and tokens in the requesting pane after explicit activation', async () => {
    window.localStorage.setItem('orca.orchestration-panel.run:requester', 'selected-run')
    render(<OrchestrationStatusPanel paneKey="requester" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Enable usage collection' }))
    await waitFor(() => expect(screen.getByText('100 tokens')).toBeTruthy())
    expect(screen.getByText('claude-measured').title).toContain('session record')
    expect(usageApi.setEnabled).toHaveBeenCalledWith({ enabled: true })
    expect(usageApi.refresh).toHaveBeenCalledWith({ force: true })
    expect(source.runtimeAgentOrchestrationByPaneKey.worker.parentPaneKey).toBe(
      'actual-coordinator'
    )
  })
  it('leaves collection disabled until an explicit action and hides a background pane', async () => {
    window.localStorage.setItem('orca.orchestration-panel.run:requester', 'selected-run')
    const view = render(<OrchestrationStatusPanel paneKey="requester" />)
    await screen.findByRole('button', { name: 'Enable usage collection' })
    expect(usageApi.setEnabled).not.toHaveBeenCalled()
    expect(usageApi.getRecentSessions).not.toHaveBeenCalled()
    view.rerender(<OrchestrationStatusPanel paneKey="requester" enabled={false} />)
    expect(view.container.childElementCount).toBe(0)
  })
})
