// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CommunitySkillMetadata } from '../../../../shared/community-skills'
const metadata: CommunitySkillMetadata = {
  id: 'f51fdd2a-a156-4b54-932d-177b941a4455',
  author: 'alice',
  name: 'review',
  description: 'Review',
  version: 3,
  digest: 'a'.repeat(64),
  supportedAgents: ['codex', 'claude'],
  updatedAt: ''
}
import { useNativeChatCommunitySkillSend } from './use-native-chat-community-skill-send'
const token = '&alice/review@3'
const selections = new Map([[token, metadata]])
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
afterEach(cleanup)
it('blocks duplicate sends while fetching and retries failure without clearing the draft', async () => {
  const pending = deferred<{ body: string } & typeof metadata>()
  const readVersion = vi.fn(() => pending.promise)
  const dispatch = vi.fn()
  const hook = renderHook(() =>
    useNativeChatCommunitySkillSend({
      targetKey: 'ssh:1',
      draft: token,
      attachments: [],
      agent: 'codex',
      selections: () => selections,
      api: { readVersion }
    })
  )
  act(() => {
    hook.result.current.send(token, dispatch)
    hook.result.current.send(token, dispatch)
  })
  expect(readVersion).toHaveBeenCalledOnce()
  expect(hook.result.current.pending).toBe(true)
  await act(async () => pending.reject(new Error('Hidden or offline')))
  expect(dispatch).not.toHaveBeenCalled()
  expect(hook.result.current.error).toContain('Hidden or offline')
  readVersion.mockResolvedValue({ ...metadata, body: 'Body' })
  await act(async () => hook.result.current.send(token, dispatch))
  expect(dispatch).toHaveBeenCalledOnce()
  expect(hook.result.current.error).toBeNull()
})
it.each(['target', 'draft', 'attachments'] as const)(
  'discards a fetch when %s changes',
  async (change) => {
    const pending = deferred<{ body: string } & typeof metadata>()
    const dispatch = vi.fn()
    const initial: { targetKey: string; draft: string; attachments: { path: string }[] } = {
      targetKey: 'wsl:1',
      draft: token,
      attachments: []
    }
    const hook = renderHook(
      (props) =>
        useNativeChatCommunitySkillSend({
          ...props,
          agent: 'claude',
          selections: () => selections,
          api: { readVersion: () => pending.promise }
        }),
      { initialProps: initial }
    )
    act(() => hook.result.current.send(token, dispatch))
    hook.rerender({
      ...initial,
      ...(change === 'target'
        ? { targetKey: 'ssh:2' }
        : change === 'draft'
          ? { draft: 'next draft' }
          : { attachments: [{ path: '/new.png' }] })
    })
    await act(async () => pending.resolve({ ...metadata, body: 'Body' }))
    expect(dispatch).not.toHaveBeenCalled()
    expect(hook.result.current.pending).toBe(false)
    if (change === 'target') {
      expect(hook.result.current.error).toBeNull()
    }
  }
)
it('ignores late errors after unmount', async () => {
  const pending = deferred<{ body: string } & typeof metadata>()
  const dispatch = vi.fn()
  const hook = renderHook(() =>
    useNativeChatCommunitySkillSend({
      targetKey: 'local',
      draft: token,
      attachments: [],
      agent: 'codex',
      selections: () => selections,
      api: { readVersion: () => pending.promise }
    })
  )
  act(() => hook.result.current.send(token, dispatch))
  hook.unmount()
  await act(async () => pending.reject(new Error('late')))
  expect(dispatch).not.toHaveBeenCalled()
})

it('times out a stalled version read, clears the lock, and ignores its late completion', async () => {
  vi.useFakeTimers()
  const pending = deferred<{ body: string } & typeof metadata>()
  const dispatch = vi.fn()
  const hook = renderHook(() =>
    useNativeChatCommunitySkillSend({
      targetKey: 'timeout',
      draft: token,
      attachments: [],
      agent: 'codex',
      selections: () => selections,
      api: { readVersion: () => pending.promise }
    })
  )
  act(() => hook.result.current.send(token, dispatch))
  await act(async () => vi.advanceTimersByTime(15_000))
  expect(hook.result.current.pending).toBe(false)
  expect(hook.result.current.error).toMatch(/timed out/i)
  await act(async () => pending.resolve({ ...metadata, body: 'late' }))
  expect(dispatch).not.toHaveBeenCalled()
  vi.useRealTimers()
})

it('cancels an in-flight resolution on Stop and preserves the draft', async () => {
  const pending = deferred<{ body: string } & typeof metadata>()
  const dispatch = vi.fn()
  const hook = renderHook(() =>
    useNativeChatCommunitySkillSend({
      targetKey: 'stop',
      draft: token,
      attachments: [],
      agent: 'codex',
      selections: () => selections,
      api: { readVersion: () => pending.promise }
    })
  )
  act(() => hook.result.current.send(token, dispatch))
  act(() => hook.result.current.cancel())
  expect(hook.result.current.pending).toBe(false)
  await act(async () => pending.resolve({ ...metadata, body: 'Late cancelled body' }))
  expect(dispatch).not.toHaveBeenCalled()
})

it('does not resurrect loading when the user edits then restores the draft before an old fetch settles', async () => {
  const pending = deferred<{ body: string } & typeof metadata>()
  const readVersion = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ ...metadata, body: 'Current body' })
  const dispatch = vi.fn()
  const hook = renderHook(
    ({ draft }) =>
      useNativeChatCommunitySkillSend({
        targetKey: 'restore',
        draft,
        attachments: [],
        agent: 'codex',
        selections: () => selections,
        api: { readVersion }
      }),
    { initialProps: { draft: token } }
  )
  act(() => hook.result.current.send(token, dispatch))
  hook.rerender({ draft: 'edited' })
  hook.rerender({ draft: token })
  expect(hook.result.current.pending).toBe(false)
  await act(async () => hook.result.current.send(token, dispatch))
  expect(dispatch).toHaveBeenCalledOnce()
  await act(async () => pending.resolve({ ...metadata, body: 'Stale body' }))
  expect(dispatch).toHaveBeenCalledOnce()
})
