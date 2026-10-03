// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../store'
import { TooltipProvider } from '../ui/tooltip'
import { UpdateStatusSegment } from './UpdateStatusSegment'
import { isUpdateCardVisible } from '../maintenance/update-card/update-card-visibility'

const ready = { state: 'downloaded', version: '1.4.218', externalManager: 'python' } as const
beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('keeps the ready text even at icon-only density, explains installation, and disappears when cleared', () => {
  useAppStore.getState().setUpdateStatus(ready)
  render(
    <TooltipProvider>
      <UpdateStatusSegment compact iconOnly />
    </TooltipProvider>
  )
  const button = screen.getByRole('button', { name: '업데이트 준비됨' })
  expect(button.textContent).toContain('업데이트 준비됨')
  fireEvent.click(button)
  expect(screen.getByText('v1.4.218')).toBeTruthy()
  expect(screen.getByText(/Orca를 완전히 종료하면/)).toBeTruthy()
  act(() => useAppStore.getState().setUpdateStatus({ state: 'idle' }))
  expect(screen.queryByRole('button', { name: '업데이트 준비됨' })).toBeNull()
})
it('does not expose the built-in install card for a Python-owned update', () => {
  expect(
    isUpdateCardVisible({
      status: ready,
      dismissedVersion: null,
      cachedVersion: ready.version,
      updateUserInitiatedCycle: false
    })
  ).toBe(false)
})
