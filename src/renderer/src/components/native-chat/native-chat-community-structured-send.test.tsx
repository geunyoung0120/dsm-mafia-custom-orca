// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import { useNativeChatStructuredComposerSend } from './use-native-chat-structured-composer-send'
vi.mock('@/lib/native-chat-telemetry', () => ({ emitNativeChatMessageSent: vi.fn() }))
vi.mock('@/lib/worker-terminal-takeover-report', () => ({
  reportStructuredSessionUserInput: vi.fn()
}))
afterEach(cleanup)
function harness() {
  let resolve!: (result: { handled: boolean; accepted: boolean; error: string | null }) => void
  const transport: NativeChatStructuredComposerTransport = {
    send: vi.fn(() => true),
    dispatchCommand: vi.fn(
      () =>
        new Promise<{ handled: boolean; accepted: boolean; error: string | null }>((yes) => {
          resolve = yes
        })
    ),
    onError: vi.fn(),
    optionSnapshot: [],
    runtime: 'remote',
    sessionId: 'session',
    runtimeEnvironmentId: 'ssh',
    optionsSurface: {
      getSnapshot: () => [],
      subscribe: () => () => {},
      setOption: vi.fn(),
      invokeAction: vi.fn()
    }
  }
  const setDraft = vi.fn()
  const args = {
    agent: 'codex' as const,
    imageAttachments: [],
    structuredTransport: transport,
    setDraft,
    setCaret: vi.fn(),
    clearImageAttachments: vi.fn(),
    clearSkillOrigin: vi.fn(),
    setHistory: vi.fn()
  }
  const hook = renderHook(
    ({ targetKey, draft }) => useNativeChatStructuredComposerSend({ ...args, targetKey, draft }),
    { initialProps: { targetKey: 'ssh:old', draft: '&alice/review@3 work' } }
  )
  return {
    hook,
    transport,
    setDraft,
    resolve: () => resolve({ handled: false, accepted: false, error: null })
  }
}
it('does not submit or clear on a target change between body resolution and structured command dispatch', async () => {
  const { hook, transport, setDraft, resolve } = harness()
  act(() => hook.result.current('Resolved user context', [], '&alice/review@3 work'))
  hook.rerender({ targetKey: 'ssh:new', draft: 'new draft' })
  await act(async () => resolve())
  expect(transport.send).not.toHaveBeenCalled()
  expect(transport.onError).not.toHaveBeenCalled()
  expect(setDraft).not.toHaveBeenCalled()
})
it('keeps an edited draft after acceptance and stores only the original draft in history', async () => {
  const { hook, transport, setDraft, resolve } = harness()
  act(() => hook.result.current('Resolved user context', [], '&alice/review@3 work'))
  hook.rerender({ targetKey: 'ssh:old', draft: 'new draft' })
  await act(async () => resolve())
  expect(transport.send).toHaveBeenCalledWith('Resolved user context', [])
  expect(setDraft).not.toHaveBeenCalled()
})
