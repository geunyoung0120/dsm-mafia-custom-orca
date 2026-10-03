// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useNativeChatCommunitySkills } from './use-native-chat-community-skills'
import type { CommunitySkillMetadata } from '../../../../shared/community-skills'
const metadata: CommunitySkillMetadata = {
  id: 'f51fdd2a-a156-4b54-932d-177b941a4455',
  author: 'alice',
  name: 'review',
  description: 'Review',
  version: 3,
  digest: 'a'.repeat(64),
  supportedAgents: ['codex'],
  updatedAt: ''
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
it('debounces metadata-only search, excludes incompatible rows, and ignores stale queries/targets', async () => {
  vi.useFakeTimers()
  const search =
    vi.fn<
      (_: { query?: string }) => Promise<{ items: CommunitySkillMetadata[]; hasMore: boolean }>
    >()
  let resolveOld!: (value: { items: CommunitySkillMetadata[]; hasMore: boolean }) => void
  search.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      })
  )
  search.mockResolvedValue({
    items: [metadata, { ...metadata, supportedAgents: ['grok'] }],
    hasMore: false
  })
  const api = { status: async () => ({ configured: true, author: null }), search }
  const hook = renderHook(
    ({ query, targetKey }) =>
      useNativeChatCommunitySkills({ query, targetKey, agent: 'codex', api }),
    { initialProps: { query: 'rev', targetKey: 'local' } }
  )
  await act(async () => vi.advanceTimersByTime(249))
  expect(search).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTime(1))
  expect(search).toHaveBeenCalledExactlyOnceWith({ query: 'rev' })
  hook.rerender({ query: 'review', targetKey: 'ssh:2' })
  expect(hook.result.current.items).toEqual([])
  await act(async () => vi.advanceTimersByTime(250))
  expect(hook.result.current.items).toHaveLength(1)
  await act(async () => resolveOld({ items: [{ ...metadata, name: 'stale' }], hasMore: false }))
  expect(hook.result.current.items[0]?.token).toBe('&alice/review@3')
})
it('surfaces unavailable status and retries rejected searches', async () => {
  vi.useFakeTimers()
  const search = vi
    .fn()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue({ items: [metadata], hasMore: false })
  const api = { status: async () => ({ configured: true, author: null }), search }
  const hook = renderHook(() =>
    useNativeChatCommunitySkills({ query: '', targetKey: 'local', agent: 'codex', api })
  )
  await act(async () => vi.advanceTimersByTime(250))
  expect(hook.result.current.status).toBe('error')
  act(() => hook.result.current.retry())
  await act(async () => vi.advanceTimersByTime(250))
  expect(hook.result.current.status).toBe('ready')
  const unavailable = renderHook(() =>
    useNativeChatCommunitySkills({ query: '', targetKey: 'local', agent: 'codex', api: undefined })
  )
  await act(async () => vi.advanceTimersByTime(250))
  expect(unavailable.result.current.errorKind).toBe('unavailable')
})

it('does not search for an unsupported provider', async () => {
  vi.useFakeTimers()
  const search = vi.fn()
  const api = { status: async () => ({ configured: true, author: null }), search }
  const hook = renderHook(() =>
    useNativeChatCommunitySkills({
      query: 'review',
      targetKey: 'unsupported',
      agent: 'gemini',
      api
    })
  )
  await act(async () => vi.advanceTimersByTime(250))
  expect(search).not.toHaveBeenCalled()
  expect(hook.result.current.status).toBe('error')
  expect(hook.result.current.error).toMatch(/provider/i)
})
