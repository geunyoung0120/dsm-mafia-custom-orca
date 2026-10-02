import { describe, expect, it } from 'vitest'
import type {
  AgentStatusEntry,
  AgentStatusOrchestrationContext
} from '../../../../shared/agent-status-types'
import {
  buildOrchestrationStatusRows,
  orchestrationRunOptions,
  sessionUsageForWorker
} from './orchestration-status-rows'

const now = 2_000_000
function entry(paneKey: string, patch: Partial<AgentStatusEntry> = {}): AgentStatusEntry {
  return {
    paneKey,
    state: 'working',
    prompt: 'Fix login',
    updatedAt: now,
    stateStartedAt: now,
    stateHistory: [],
    agentType: 'codex',
    model: 'gpt-test',
    ...patch
  }
}
function context(dispatchId: string, parentPaneKey: string): AgentStatusOrchestrationContext {
  return { dispatchId, taskId: `task_${dispatchId}`, taskTitle: 'Review login', parentPaneKey }
}
function roster(
  contexts: Record<string, AgentStatusOrchestrationContext>,
  live: Record<string, AgentStatusEntry> = {}
) {
  return buildOrchestrationStatusRows({
    parentPaneKey: 'parent',
    live,
    retained: {},
    contexts,
    now
  })
}

describe('coordinator worker roster', () => {
  it('does not resurrect closed workers from a late runtime context or retained hook', () => {
    const paneKey = 'closed-tab:worker-leaf'
    const source = {
      parentPaneKey: 'parent',
      contexts: {
        [paneKey]: {
          ...context('closed', 'parent'),
          dispatchStatus: 'completed' as const,
          orchestrationRunId: 'closed-run'
        }
      },
      live: {},
      retained: {
        [paneKey]: { entry: entry(paneKey, { state: 'done' }) }
      },
      closedTabs: { 'closed-tab': true as const },
      now
    }
    expect(buildOrchestrationStatusRows(source)).toEqual([])
    expect(orchestrationRunOptions(source)).toEqual([])
    expect(buildOrchestrationStatusRows({ ...source, runId: 'closed-run' })).toEqual([])
  })
  it('drops an explicitly retired split pane without hiding its sibling', () => {
    const source = {
      parentPaneKey: 'parent',
      contexts: {
        'tab:closed': context('closed', 'parent'),
        'tab:open': context('open', 'parent')
      },
      live: {},
      retained: {},
      retiredPanes: { 'tab:closed': true as const },
      now
    }
    expect(buildOrchestrationStatusRows(source).map((row) => row.paneKey)).toEqual(['tab:open'])
  })
  it('removes settled orphan contexts after reload without suppressing unproven active work', () => {
    const source = {
      parentPaneKey: 'parent',
      contexts: {
        'old-tab:done': { ...context('done', 'parent'), dispatchStatus: 'completed' as const },
        'old-tab:failed': { ...context('failed', 'parent'), dispatchStatus: 'failed' as const },
        'remote-tab:working': {
          ...context('active', 'parent'),
          dispatchStatus: 'dispatched' as const
        }
      },
      live: {},
      retained: {},
      openTabIds: new Set<string>(),
      now
    }
    expect(buildOrchestrationStatusRows(source).map((row) => row.dispatchId)).toEqual(['active'])
  })
  it('preserves the measured identity of completed workers whose tabs are still open', () => {
    const paneKey = 'open-tab:worker'
    const rows = buildOrchestrationStatusRows({
      parentPaneKey: 'parent',
      contexts: { [paneKey]: { ...context('done', 'parent'), dispatchStatus: 'completed' } },
      live: {},
      retained: {
        [paneKey]: {
          entry: entry(paneKey, {
            state: 'done',
            providerSession: { key: 'session_id', id: 'completed-session' }
          })
        }
      },
      openTabIds: new Set(['open-tab']),
      now
    })
    expect(rows[0]).toMatchObject({
      state: 'done',
      model: 'gpt-test',
      sessionId: 'completed-session'
    })
  })
  it('continues tracking a live descendant after its completed parent pane is closed', () => {
    const source = {
      parentPaneKey: 'parent',
      contexts: {
        'closed-tab:worker': context('closed', 'parent'),
        child: context('child', 'closed-tab:worker')
      },
      live: {},
      retained: {},
      closedTabs: { 'closed-tab': true as const },
      now
    }
    expect(buildOrchestrationStatusRows(source).map((row) => row.paneKey)).toEqual(['child'])
  })
  it('can display a selected run under the requesting pane without changing its coordinator', () => {
    const contexts = {
      a: { ...context('a', 'different-coordinator'), orchestrationRunId: 'run-a' },
      b: { ...context('b', 'different-coordinator'), orchestrationRunId: 'run-b' }
    }
    const source = {
      parentPaneKey: 'requester',
      contexts,
      live: { a: entry('a') },
      retained: {},
      now
    }
    expect(buildOrchestrationStatusRows(source)).toEqual([])
    expect(
      buildOrchestrationStatusRows({ ...source, runId: 'run-a' }).map((row) => row.paneKey)
    ).toEqual(['a'])
    expect(contexts.a.parentPaneKey).toBe('different-coordinator')
  })
  it('shows only the exact parent fleet and its descendants, across workspaces', () => {
    const rows = roster(
      { a: context('a', 'parent'), b: context('b', 'a'), other: context('c', 'someone-else') },
      { a: entry('a', { worktreeId: 'folder' }), b: entry('b', { worktreeId: 'another-worktree' }) }
    )
    expect(rows.map((row) => row.paneKey)).toEqual(['a', 'b'])
    expect(rows[0]).toMatchObject({ task: 'Review login', model: 'gpt-test', provider: 'codex' })
  })
  it('does not include the coordinator in a cyclic parent graph', () => {
    expect(
      roster({ a: context('a', 'parent'), parent: context('p', 'a') }).map((row) => row.paneKey)
    ).toEqual(['a'])
  })
  it('can show a dispatched worker before its first hook arrives', () => {
    expect(
      roster({ a: { ...context('a', 'parent'), dispatchStatus: 'pending' } })[0]
    ).toMatchObject({ state: 'pending', model: null, sessionId: null })
  })
  it('shows a failed dispatch even if the last hook was working', () => {
    expect(
      roster({ a: { ...context('a', 'parent'), dispatchStatus: 'failed' } }, { a: entry('a') })[0]
        .state
    ).toBe('failed')
  })
  it('retains completed workers after their live hook disappears', () => {
    const rows = buildOrchestrationStatusRows({
      parentPaneKey: 'parent',
      contexts: {},
      live: {},
      now,
      retained: {
        a: { entry: entry('a', { state: 'done', orchestration: context('a', 'parent') }) }
      }
    })
    expect(rows[0].state).toBe('done')
  })
  it('does not borrow model or usage from a previous dispatch on a reused pane', () => {
    const rows = roster(
      { a: context('new', 'parent') },
      {
        a: entry('a', {
          orchestration: context('old', 'parent'),
          providerSession: { key: 'session_id', id: 'old-session' }
        })
      }
    )
    expect(rows[0]).toMatchObject({
      dispatchId: 'new',
      model: null,
      sessionId: null,
      state: 'unverifiable'
    })
  })
  it('uses a parent terminal handle only when no parent pane key was supplied', () => {
    const rows = roster(
      {
        a: { dispatchId: 'a', taskId: 'a', parentTerminalHandle: 'terminal_parent' },
        b: { ...context('b', 'different'), parentTerminalHandle: 'terminal_parent' }
      },
      { parent: entry('parent', { terminalHandle: 'terminal_parent' }) }
    )
    expect(rows.map((row) => row.paneKey)).toEqual(['a'])
  })
  it('does not describe restored or stale execution as working', () => {
    expect(
      roster({ a: context('a', 'parent') }, { a: entry('a', { restoredUnconfirmed: true }) })[0]
        .state
    ).toBe('unverifiable')
    expect(
      roster({ a: context('a', 'parent') }, { a: entry('a', { updatedAt: 0 }) })[0].state
    ).toBe('unverifiable')
  })
  it('marks a paired-host mirror as remote even when it has no SSH connection id', () => {
    const rows = roster(
      { a: context('a', 'parent') },
      {
        a: entry('a', {
          mirroredEvidenceReceivedAt: now,
          providerSession: { key: 'session_id', id: 'session-a' }
        })
      }
    )
    expect(
      sessionUsageForWorker(rows[0], [
        { provider: 'codex', sessionId: 'session-a', totalTokens: 42, model: null }
      ])
    ).toBeNull()
  })
})

describe('provider/session usage attribution', () => {
  const worker = roster(
    { a: context('a', 'parent') },
    { a: entry('a', { providerSession: { key: 'session_id', id: 'session-a' } }) }
  )[0]
  it('matches exact provider and session, never a model or project label', () => {
    const usage = [
      { provider: 'claude', sessionId: 'session-a', totalTokens: 900, model: 'wrong' },
      { provider: 'codex', sessionId: 'other', totalTokens: 800, model: 'gpt-test' },
      { provider: 'codex', sessionId: 'session-a', totalTokens: 42, model: 'gpt-test' }
    ]
    expect(sessionUsageForWorker(worker, usage)?.totalTokens).toBe(42)
  })
  it('preserves measured zero and keeps unknown distinct', () => {
    expect(sessionUsageForWorker(worker, [])).toBeNull()
    expect(
      sessionUsageForWorker(worker, [
        { provider: 'codex', sessionId: 'session-a', totalTokens: 0, model: null }
      ])?.totalTokens
    ).toBe(0)
  })
  it('never uses local usage for a remote worker with an identical session id', () => {
    expect(
      sessionUsageForWorker({ ...worker, connectionId: 'ssh-host' }, [
        { provider: 'codex', sessionId: 'session-a', totalTokens: 42, model: null }
      ])
    ).toBeNull()
  })
  it('rejects negative and non-finite provider values', () => {
    for (const totalTokens of [-1, Infinity, Number.NaN]) {
      expect(
        sessionUsageForWorker(worker, [
          { provider: 'codex', sessionId: 'session-a', totalTokens, model: null }
        ])
      ).toBeNull()
    }
  })
})
