// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationStatusRoster } from './OrchestrationStatusRoster'
import type { OrchestrationStatusRow } from './orchestration-status-rows'
const row: OrchestrationStatusRow = {
  paneKey: 'a',
  dispatchId: 'd',
  task: 'Review login',
  provider: 'codex',
  model: 'gpt-test',
  sessionId: 's',
  connectionId: null,
  state: 'working'
}
afterEach(cleanup)
describe('compact worker panel', () => {
  it('renders nothing when the coordinator has no workers', () => {
    const { container } = render(
      <OrchestrationStatusRoster rows={[]} usage={{ sessions: [], availability: {} }} />
    )
    expect(container.childElementCount).toBe(0)
  })
  it('shows actual model, assigned task and measured zero tokens', () => {
    render(
      <OrchestrationStatusRoster
        rows={[row]}
        usage={{
          sessions: [{ provider: 'codex', sessionId: 's', totalTokens: 0, model: null }],
          availability: { codex: 'ready' }
        }}
      />
    )
    expect(screen.getByText('gpt-test')).toBeTruthy()
    expect(screen.getByText('Review login')).toBeTruthy()
    expect(screen.getByText('0 tokens')).toBeTruthy()
    expect(screen.getByText('Session totals')).toBeTruthy()
  })
  it('keeps missing measurements distinct from measured zero', () => {
    render(
      <OrchestrationStatusRoster
        rows={[{ ...row, model: null }]}
        usage={{ sessions: [], availability: { codex: 'disabled' } }}
      />
    )
    expect(screen.getByText('Model unknown')).toBeTruthy()
    expect(screen.getByText('Collection off')).toBeTruthy()
    expect(screen.queryByText('0 tokens')).toBeNull()
  })
  it('collapses the roster without removing its summary', () => {
    render(<OrchestrationStatusRoster rows={[row]} usage={{ sessions: [], availability: {} }} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByText('Review login')).toBeNull()
    expect(screen.getByText('1 worker')).toBeTruthy()
  })
  it('identifies a model from the exact session record and labels its source', () => {
    render(
      <OrchestrationStatusRoster
        rows={[{ ...row, model: null }]}
        usage={{
          sessions: [
            { provider: 'codex', sessionId: 's', totalTokens: 100, model: 'historical-model' }
          ],
          availability: { codex: 'ready' }
        }}
      />
    )
    expect(screen.getByText('historical-model')).toBeTruthy()
    expect(screen.getByText('historical-model').title).toContain('session record')
  })
  it('offers collection activation only for a disabled local provider', () => {
    const enable = vi.fn()
    render(
      <OrchestrationStatusRoster
        rows={[row]}
        usage={{ sessions: [], availability: { codex: 'disabled' } }}
        onEnableUsage={enable}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Enable usage collection' }))
    expect(enable).toHaveBeenCalledWith('codex')
  })
})
