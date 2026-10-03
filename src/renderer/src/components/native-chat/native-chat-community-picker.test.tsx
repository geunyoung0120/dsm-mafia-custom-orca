// @vitest-environment happy-dom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CommunitySkillMetadata } from '../../../../shared/community-skills'
import { useNativeChatPickerState } from './use-native-chat-picker-state'
import { NativeChatPickerMenu } from './NativeChatAutocompleteMenus'
import { useNativeChatComposerKeyDown } from './use-native-chat-composer-keydown'
import { EMPTY_HISTORY, type ComposerAutocomplete } from './native-chat-composer-state'
import type { NativeChatPickerItem } from './native-chat-picker-items'
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
const api = {
  status: async () => ({ configured: true, author: null }),
  search: async () => ({ items: [metadata], hasMore: false })
}
vi.mock('./use-native-chat-skills', () => ({
  useNativeChatSkills: () => ({ status: 'ready', skills: [], retry: vi.fn() })
}))
vi.mock('@/lib/native-chat-telemetry', () => ({
  emitNativeChatPickerOpened: vi.fn(),
  emitNativeChatPickerItemAccepted: vi.fn(),
  emitNativeChatSendClassified: vi.fn()
}))
vi.mock('@/lib/community-skill-api', () => ({ getCommunitySkillsApi: () => api }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
it('extends the existing picker, pins exact identities, dismisses and resets on target changes', async () => {
  vi.useFakeTimers()
  const setDraft = vi.fn()
  const hook = renderHook(
    ({ draft, targetKey }) =>
      useNativeChatPickerState({
        agent: 'codex',
        terminalTabId: 'tab',
        draftScopeKey: 'pane',
        targetKey,
        draft,
        caret: draft.length,
        agentCommands: [],
        textareaRef: createRef(),
        setDraft,
        setCaret: vi.fn(),
        setActiveSuggestion: vi.fn()
      }),
    { initialProps: { draft: '&rev', targetKey: 'local' } }
  )
  await act(async () => vi.advanceTimersByTime(250))
  const picker = hook.result.current.autocomplete
  expect(picker).toMatchObject({ mode: 'slash', prefix: '&', dispatchable: false })
  if (picker.mode !== 'slash') {
    throw new Error('Expected picker')
  }
  expect(picker.items[0]?.kind).toBe('community-skill')
  act(() => hook.result.current.completeItem(picker.items[0]))
  expect(setDraft).toHaveBeenCalledWith('&alice/review@3 ')
  expect(hook.result.current.readCommunitySelections().get('&alice/review@3')).toEqual(metadata)
  act(() => hook.result.current.dismiss(picker.triggerKey))
  expect(hook.result.current.autocomplete.mode).toBe('none')
  hook.rerender({ draft: '&alice/review@3', targetKey: 'ssh:2' })
  expect(hook.result.current.readCommunitySelections().size).toBe(0)
})
it('renders qualified versions and context-cost disclosure in the same menu', () => {
  const item: NativeChatPickerItem = {
    kind: 'community-skill',
    id: metadata.id,
    name: 'alice/review',
    token: '&alice/review@3',
    description: metadata.description,
    metadata
  }
  const autocomplete: ComposerAutocomplete = {
    mode: 'slash',
    prefix: '&',
    query: '',
    triggerKey: '&:0',
    dispatchable: false,
    grouped: false,
    commandsEnabled: false,
    skillsEnabled: true,
    skillStatus: 'ready',
    items: [item]
  }
  const choose = vi.fn()
  const view = render(
    <NativeChatPickerMenu
      autocomplete={autocomplete}
      activeIndex={0}
      listboxId="picker"
      onChoose={choose}
      onRetry={vi.fn()}
    />
  )
  expect(view.getByRole('option').textContent).toContain('&alice/review@3')
  expect(view.getByText(/consume tokens/i)).toBeDefined()
  fireEvent.pointerDown(view.getByRole('option'))
  expect(choose).toHaveBeenCalledWith(item)
})
it('uses arrow/Enter/Tab/Escape controls and refuses IME acceptance', () => {
  const item = {
    kind: 'community-skill',
    id: metadata.id,
    name: 'alice/review',
    token: '&alice/review@3',
    description: metadata.description,
    metadata
  } as const
  const complete = vi.fn(),
    send = vi.fn(),
    dismiss = vi.fn(),
    move = vi.fn()
  let composing = false
  function Harness() {
    const onKeyDown = useNativeChatComposerKeyDown({
      autocomplete: {
        mode: 'slash',
        prefix: '&',
        query: '',
        triggerKey: '&:0',
        dispatchable: false,
        grouped: false,
        commandsEnabled: false,
        skillsEnabled: true,
        skillStatus: 'ready',
        items: [item]
      },
      activeSuggestion: 0,
      draft: '&',
      history: EMPTY_HISTORY,
      isComposing: () => composing,
      completePickerItem: complete,
      dispatchPickerCommand: vi.fn(),
      dismissPicker: dismiss,
      interrupt: vi.fn(),
      send,
      setActiveSuggestion: move,
      setDraft: vi.fn(),
      setCaret: vi.fn(),
      setHistory: vi.fn()
    })
    return <textarea onKeyDown={onKeyDown} />
  }
  const view = render(<Harness />),
    input = view.getByRole('textbox')
  fireEvent.keyDown(input, { key: 'ArrowDown' })
  fireEvent.keyDown(input, { key: 'ArrowUp' })
  expect(move).toHaveBeenCalledTimes(2)
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.keyDown(input, { key: 'Tab' })
  expect(complete).toHaveBeenCalledTimes(2)
  composing = true
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(complete).toHaveBeenCalledTimes(2)
  composing = false
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(dismiss).toHaveBeenCalledWith('&:0')
  expect(send).not.toHaveBeenCalled()
})

it('recognizes typed selected references without replacing them with the latest menu row', async () => {
  vi.useFakeTimers()
  const args = {
    agent: 'codex' as const,
    terminalTabId: 'typed-tab',
    draftScopeKey: 'typed-pane',
    targetKey: 'typed-target',
    agentCommands: [],
    textareaRef: createRef<HTMLTextAreaElement>(),
    setDraft: vi.fn(),
    setCaret: vi.fn(),
    setActiveSuggestion: vi.fn()
  }
  const hook = renderHook(
    ({ draft }) => useNativeChatPickerState({ ...args, draft, caret: draft.length }),
    { initialProps: { draft: '&rev' } }
  )
  await act(async () => vi.advanceTimersByTime(250))
  const picker = hook.result.current.autocomplete
  if (picker.mode !== 'slash') {
    throw new Error('Expected picker')
  }
  act(() => hook.result.current.completeItem(picker.items[0]))
  hook.rerender({ draft: '&alice/review@3' })
  expect(hook.result.current.autocomplete.mode).toBe('none')
  hook.unmount()
  const restored = renderHook(() =>
    useNativeChatPickerState({ ...args, draft: '&alice/review@3', caret: 15 })
  )
  expect(restored.result.current.readCommunitySelections().get('&alice/review@3')?.id).toBe(
    metadata.id
  )
})
