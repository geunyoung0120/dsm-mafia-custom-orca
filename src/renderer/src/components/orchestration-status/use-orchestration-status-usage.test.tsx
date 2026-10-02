// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOrchestrationStatusUsage } from './use-orchestration-status-usage'
import { loadOrchestrationUsage } from './orchestration-status-usage'
import type { OrchestrationStatusRow } from './orchestration-status-rows'

vi.mock(import('./orchestration-status-usage'), async (importOriginal) => ({
  ...(await importOriginal()),
  loadOrchestrationUsage: vi.fn()
}))
const row: OrchestrationStatusRow = {
  paneKey: 'a',
  dispatchId: 'd',
  task: 'Review',
  provider: 'codex',
  model: null,
  sessionId: 's',
  connectionId: null,
  state: 'working'
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})
describe('visible usage polling', () => {
  it('skips interval ticks while a scan is still in flight', async () => {
    vi.useFakeTimers()
    vi.mocked(loadOrchestrationUsage).mockImplementation(() => new Promise(() => {}))
    const { unmount } = renderHook(() => useOrchestrationStatusUsage([row], true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    expect(loadOrchestrationUsage).toHaveBeenCalledTimes(1)
    unmount()
  })
  it('polls serially and releases its timer on unmount', async () => {
    vi.useFakeTimers()
    vi.mocked(loadOrchestrationUsage).mockResolvedValue({ sessions: [], availability: {} })
    const { unmount } = renderHook(() => useOrchestrationStatusUsage([row], true))
    await act(async () => {
      await Promise.resolve()
    })
    expect(loadOrchestrationUsage).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(loadOrchestrationUsage).toHaveBeenCalledTimes(2)
    unmount()
    await vi.advanceTimersByTimeAsync(10000)
    expect(loadOrchestrationUsage).toHaveBeenCalledTimes(2)
  })
  it('does not collect for a hidden panel or a remote-only fleet', async () => {
    const { rerender } = renderHook(
      ({ visible, rows }) => useOrchestrationStatusUsage(rows, visible),
      { initialProps: { visible: false, rows: [row] } }
    )
    rerender({ visible: true, rows: [{ ...row, connectionId: 'ssh' }] })
    expect(loadOrchestrationUsage).not.toHaveBeenCalled()
  })
  it('ignores a stale response after the worker session changes', async () => {
    let resolveOld: (value: {
      sessions: []
      availability: { codex: 'disabled' }
    }) => void = () => {}
    vi.mocked(loadOrchestrationUsage)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          })
      )
      .mockResolvedValue({ sessions: [], availability: { codex: 'ready' } })
    const { result, rerender } = renderHook(({ rows }) => useOrchestrationStatusUsage(rows, true), {
      initialProps: { rows: [row] }
    })
    rerender({ rows: [{ ...row, sessionId: 'new' }] })
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      resolveOld({ sessions: [], availability: { codex: 'disabled' } })
      await Promise.resolve()
    })
    expect(result.current.availability.codex).toBe('ready')
  })
  it('does not restart polling when only the working status changes', async () => {
    vi.useFakeTimers()
    vi.mocked(loadOrchestrationUsage).mockResolvedValue({ sessions: [], availability: {} })
    const { rerender } = renderHook(({ rows }) => useOrchestrationStatusUsage(rows, true), {
      initialProps: { rows: [row] }
    })
    await act(async () => {
      await Promise.resolve()
    })
    rerender({ rows: [{ ...row, state: 'waiting' }] })
    expect(loadOrchestrationUsage).toHaveBeenCalledTimes(1)
  })
})
