// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { GeneralUpdateSettingsSection } from './GeneralUpdateSettingsSection'

vi.mock('./GeneralRemoteServerUpdates', () => ({
  GeneralRemoteServerUpdates: () => <div>Remote server updates</div>
}))
vi.mock('./ReleaseChannelSection', () => ({ ReleaseChannelSection: () => null }))

beforeEach(() => {
  useAppStore.setState({
    updateStatus: { state: 'available', version: '1.4.200', changelog: null }
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      updater: {
        check: vi.fn(),
        download: vi.fn(),
        getVersion: vi.fn().mockResolvedValue('1.4.199')
      }
    }
  })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ updateStatus: { state: 'idle' } })
})

it('keeps remote updates but removes desktop update controls even with stale available state', () => {
  render(<GeneralUpdateSettingsSection />)
  expect(screen.queryByRole('button', { name: /Update/ })).toBeNull()
  expect(screen.queryByText(/is available/)).toBeNull()
  expect(screen.getByText('Remote server updates')).toBeTruthy()
  expect(window.api.updater.getVersion).not.toHaveBeenCalled()
})
