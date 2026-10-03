// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { NativeChatComposerFieldProps } from './NativeChatComposerField'
const mocks = vi.hoisted(() => {
  const fieldProps: { current: NativeChatComposerFieldProps | null } = { current: null }
  const state: {
    imageAttachments: { id: string; path: string; pending?: boolean }[]
    composerIsComposing: (() => boolean) | null
  } = { imageAttachments: [], composerIsComposing: null }
  return {
    fieldProps,
    state,
    cancelPendingSends: vi.fn(),
    flushPendingAttachments: vi.fn(),
    createClaudeModelSwitchConfirmationObserver: vi.fn(),
    discoverCommitMessageModels: vi.fn(),
    draft: 'hello',
    getMainBufferSnapshot: vi.fn(),
    sendHandle: { cancel: vi.fn(), settleAfterMs: 500 },
    sendNativeChatMessage: vi.fn(),
    sendNativeChatMessageWithImageAttachments: vi.fn(),
    sendNativeChatTypedCommand: vi.fn(),
    sendNativeChatMessageVerified: vi.fn(),
    typeNativeChatCommand: vi.fn(),
    trackPendingSend: vi.fn(),
    setDraft: vi.fn(),
    clearNativeChatLaunchDraft: vi.fn(),
    markNativeChatLaunchDraftAdopted: vi.fn()
  }
})

vi.mock('../../store', () => {
  const state = {
    dictationState: 'idle',
    settings: { voice: { enabled: false }, nativeChatSessionOptions: {} },
    agentStatusByPaneKey: {},
    updateSettings: vi.fn(),
    clearNativeChatLaunchDraft: mocks.clearNativeChatLaunchDraft,
    markNativeChatLaunchDraftAdopted: mocks.markNativeChatLaunchDraftAdopted
  }
  const useAppStore = (selector: (value: typeof state) => unknown) => selector(state)
  useAppStore.getState = () => state
  return { useAppStore }
})

vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  isRemoteRuntimePtyId: () => false,
  sendRuntimePtyInput: vi.fn()
}))
vi.mock('@/lib/agent-paste-draft', () => ({
  getSettingsForAgentTabRuntimeOwner: () => ({})
}))
vi.mock('./native-chat-runtime-send', () => ({
  sendNativeChatMessage: (...args: unknown[]) => mocks.sendNativeChatMessage(...args),
  sendNativeChatTypedCommand: (...args: unknown[]) => mocks.sendNativeChatTypedCommand(...args),
  sendNativeChatMessageVerified: (...args: unknown[]) =>
    mocks.sendNativeChatMessageVerified(...args),
  typeNativeChatCommand: (...args: unknown[]) => mocks.typeNativeChatCommand(...args),
  submitNativeChatPrompt: vi.fn()
}))
vi.mock('./native-chat-runtime-image-send', () => ({
  sendNativeChatMessageWithImageAttachments: (...args: unknown[]) =>
    mocks.sendNativeChatMessageWithImageAttachments(...args)
}))
vi.mock('./claude-model-switch-confirmation', () => ({
  createClaudeModelSwitchConfirmationObserver: (...args: unknown[]) =>
    mocks.createClaudeModelSwitchConfirmationObserver(...args)
}))
vi.mock('@/lib/native-chat-telemetry', () => ({
  emitNativeChatMessageSent: vi.fn(),
  emitNativeChatPickerItemAccepted: vi.fn(),
  emitNativeChatPickerOpened: vi.fn(),
  emitNativeChatSendClassified: vi.fn()
}))
vi.mock('./use-native-chat-draft', () => ({
  useNativeChatDraft: () => {
    return { draft: mocks.draft, setDraft: mocks.setDraft, flushDraftAppends: () => {} }
  }
}))
vi.mock('./native-chat-draft-cache', () => ({
  readNativeChatDraftCache: () => ''
}))
vi.mock('./NativeChatComposerField', () => ({
  NativeChatComposerField: (props: NativeChatComposerFieldProps) => {
    mocks.fieldProps.current = props
    return <div data-testid="native-chat-composer-field" />
  }
}))
vi.mock('./use-native-chat-skills', () => ({
  useNativeChatSkills: () => ({ status: 'ready', skills: [], error: null, retry: () => {} })
}))
vi.mock('./use-native-chat-composer-attachments', () => ({
  useNativeChatComposerAttachments: () => {
    return {
      imageAttachments: mocks.state.imageAttachments,
      attachResolvedPaths: vi.fn(),
      clearImageAttachments: vi.fn(),
      flushPendingAttachments: mocks.flushPendingAttachments,
      removeImageAttachment: vi.fn()
    }
  }
}))
vi.mock('./use-native-chat-composer-paste', () => ({
  useNativeChatComposerPaste: () => ({
    handlePaste: vi.fn(),
    pasteFromClipboard: vi.fn()
  })
}))
vi.mock('./use-native-chat-external-attachments', () => ({
  useNativeChatExternalAttachments: () => ({
    attachExternalPaths: vi.fn(),
    resolveAttachmentOwner: vi.fn()
  })
}))
vi.mock('../dictation/dictation-control-events', () => ({
  dispatchDictationControl: vi.fn()
}))
vi.mock('./use-native-chat-composer-keydown', () => ({
  useNativeChatComposerKeyDown: (args: { isComposing: () => boolean }) => {
    mocks.state.composerIsComposing = args.isComposing
    return vi.fn()
  }
}))
vi.mock('./use-native-chat-send-lifecycle', () => ({
  useNativeChatSendLifecycle: () => ({
    cancelPendingSends: mocks.cancelPendingSends,
    trackPendingSend: mocks.trackPendingSend
  })
}))

import type { NativeChatPickerItem } from './native-chat-picker-items'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'
import type {
  CommunitySkillMetadata,
  CommunitySkillVersion
} from '../../../../shared/community-skills'
import { NativeChatComposer } from './NativeChatComposer'

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
const item: NativeChatPickerItem = {
  kind: 'community-skill',
  id: metadata.id,
  name: 'alice/review',
  token: '&alice/review@3',
  description: metadata.description,
  metadata
}
const communityApi = {
  status: async () => ({ configured: true, author: null }),
  search: async () => ({ items: [metadata], hasMore: false }),
  readVersion: vi.fn<() => Promise<CommunitySkillVersion>>()
}
vi.mock('@/lib/community-skill-api', () => ({ getCommunitySkillsApi: () => communityApi }))
vi.mock('@/lib/worker-terminal-takeover-report', () => ({
  reportStructuredSessionUserInput: vi.fn()
}))
function transport(): NativeChatStructuredComposerTransport {
  return {
    send: vi.fn(() => true),
    dispatchCommand: vi.fn(async () => ({ handled: false, accepted: false, error: null })),
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
}
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      git: { discoverCommitMessageModels: mocks.discoverCommitMessageModels },
      pty: { getMainBufferSnapshot: mocks.getMainBufferSnapshot },
      ui: { onFileDrop: () => vi.fn() }
    }
  })
  mocks.draft = '&rev'
  mocks.state.imageAttachments = []
  mocks.sendNativeChatMessage.mockReturnValue(mocks.sendHandle)
  mocks.discoverCommitMessageModels.mockResolvedValue({ success: false })
  communityApi.readVersion.mockResolvedValue({ ...metadata, body: 'Pinned body' })
})
afterEach(cleanup)
it.each(['pty', 'structured'] as const)(
  'resolves one pinned body at SEND through %s, and serializes fetching',
  async (lane) => {
    let resolve!: (version: CommunitySkillVersion) => void
    communityApi.readVersion.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes
        })
    )
    const structuredTransport = lane === 'structured' ? transport() : undefined
    const props = {
      terminalTabId: 'tab-1',
      paneKey: 'tab-1:leaf-1',
      targetPtyId: 'ssh:pty-1',
      agent: 'codex' as const,
      structuredTransport
    }
    const view = render(<NativeChatComposer {...props} />)
    await waitFor(() => {
      const autocomplete = mocks.fieldProps.current?.autocomplete
      expect(autocomplete?.mode === 'slash' ? autocomplete.items.length : 0).toBe(1)
    })
    expect(communityApi.readVersion).not.toHaveBeenCalled()
    act(() => mocks.fieldProps.current?.onChoosePickerItem?.(item))
    mocks.draft = '&alice/review@3 &alice/review@3 review this'
    view.rerender(<NativeChatComposer {...props} />)
    mocks.setDraft.mockClear()
    act(() => {
      mocks.fieldProps.current?.onSend?.()
      mocks.fieldProps.current?.onSend?.()
    })
    expect(communityApi.readVersion).toHaveBeenCalledExactlyOnceWith({
      id: metadata.id,
      version: 3
    })
    expect(mocks.fieldProps.current?.sendButtonDisabled).toBe(true)
    expect(mocks.setDraft).not.toHaveBeenCalled()
    await act(async () => resolve({ ...metadata, body: 'Pinned body' }))
    const text =
      lane === 'structured'
        ? structuredTransport
          ? vi.mocked(structuredTransport.send).mock.calls[0]?.[0]
          : undefined
        : mocks.sendNativeChatMessage.mock.calls[0]?.[2]
    if (typeof text !== 'string') {
      throw new Error('Expected a sent prompt')
    }
    expect(text).toContain(metadata.id)
    expect(text).toContain(metadata.digest)
    expect(text.match(/Pinned body/g)).toHaveLength(1)
    expect(mocks.setDraft).toHaveBeenCalledWith('')
  }
)
it.each(['pty', 'structured'] as const)(
  'preserves drafts when selected resolution fails on %s',
  async (lane) => {
    communityApi.readVersion.mockRejectedValue(new Error('Hidden skill'))
    const structuredTransport = lane === 'structured' ? transport() : undefined
    const props = {
      terminalTabId: 'tab-1',
      paneKey: 'tab-1:leaf-1',
      targetPtyId: 'pty-1',
      agent: 'codex' as const,
      structuredTransport
    }
    const view = render(<NativeChatComposer {...props} />)
    await waitFor(() => {
      const autocomplete = mocks.fieldProps.current?.autocomplete
      expect(autocomplete?.mode === 'slash' ? autocomplete.items.length : 0).toBe(1)
    })
    act(() => mocks.fieldProps.current?.onChoosePickerItem?.(item))
    mocks.draft = '&alice/review@3 test'
    view.rerender(<NativeChatComposer {...props} />)
    mocks.setDraft.mockClear()
    await act(async () => mocks.fieldProps.current?.onSend?.())
    expect(mocks.setDraft).not.toHaveBeenCalled()
    expect(mocks.sendNativeChatMessage).not.toHaveBeenCalled()
    expect(mocks.fieldProps.current?.notice).toContain('Hidden skill')
    if (structuredTransport) {
      expect(structuredTransport.send).not.toHaveBeenCalled()
    }
  }
)
it('never sends an unselected raw reference', async () => {
  mocks.draft = '&alice/review@3 test'
  render(<NativeChatComposer terminalTabId="tab" paneKey="pane" targetPtyId="pty" agent="codex" />)
  await act(async () => mocks.fieldProps.current?.onSend?.())
  expect(mocks.sendNativeChatMessage).not.toHaveBeenCalled()
  expect(communityApi.readVersion).not.toHaveBeenCalled()
  expect(mocks.fieldProps.current?.notice).toMatch(/select/i)
})
