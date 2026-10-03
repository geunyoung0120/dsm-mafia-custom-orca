import type { NativeChatComposerInput } from './native-chat-composer-input'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import { getNativeChatAgentProfile } from '../../../../shared/native-chat-agent-profiles'
import type { SlashCommandSuggestion } from '../../../../shared/native-chat-slash-commands'
import {
  applyPickerSuggestion,
  classifyNativeChatSend,
  deriveComposerAutocomplete,
  editReplacesTriggerToken,
  isSkillPickerTriggered,
  type ComposerAutocomplete,
  type NativeChatPickerItem,
  type NativeChatSendClassification
} from './native-chat-composer-state'
import { getCommunitySkillsApi } from '@/lib/community-skill-api'
import {
  findCommunitySkillTrigger,
  type CommunitySkillSelections
} from '@/lib/community-skill-invocation'
import { readCommunitySkillSelectionState } from './native-chat-community-selection-cache'
import { setBoundedScopeCacheEntry } from './native-chat-composer-scope-cache'
import { useNativeChatCommunitySkills } from './use-native-chat-community-skills'
import { deriveCommunitySkillAutocomplete } from './native-chat-community-picker'
import { useNativeChatSkills } from './use-native-chat-skills'
import {
  emitNativeChatPickerItemAccepted,
  emitNativeChatPickerOpened,
  emitNativeChatSendClassified
} from '@/lib/native-chat-telemetry'

export type NativeChatPickerState = {
  autocomplete: ComposerAutocomplete
  readCommunitySelections: () => CommunitySkillSelections
  listboxId: string
  retrySkills: () => void
  classifySend: (draft: string) => NativeChatSendClassification
  clearSkillOrigin: () => void
  completeItem: (item: NativeChatPickerItem) => void
  dismiss: (triggerKey: string) => void
  handleDraftOrCaretChange: (value: string, caret: number) => void
}

export function useNativeChatPickerState(args: {
  agent: AgentType
  terminalTabId: string
  draftScopeKey: string
  targetKey?: string
  draft: string
  caret: number
  agentCommands: readonly SlashCommandSuggestion[]
  /** Skill names the running session reports; undefined keeps the host disk scan. */
  sessionSkillNames?: readonly string[]
  textareaRef: RefObject<NativeChatComposerInput | null>
  setDraft: (value: string) => void
  setCaret: Dispatch<SetStateAction<number>>
  setActiveSuggestion: Dispatch<SetStateAction<number>>
}): NativeChatPickerState {
  const {
    agent,
    terminalTabId,
    draftScopeKey,
    draft,
    caret,
    agentCommands,
    sessionSkillNames,
    textareaRef,
    setDraft,
    setCaret,
    setActiveSuggestion
  } = args
  const profile = useMemo(() => getNativeChatAgentProfile(agent), [agent])
  const skillPickerTriggered = isSkillPickerTriggered(draft.slice(0, caret), profile)
  const discovery = useNativeChatSkills(agent, terminalTabId, skillPickerTriggered)
  const communityTrigger = findCommunitySkillTrigger(draft, caret)
  const communityTarget = args.targetKey ?? `${draftScopeKey}:${agent}`
  const selectionState = useMemo(
    () => readCommunitySkillSelectionState(communityTarget),
    [communityTarget]
  )
  const readCommunitySelections = useCallback(() => selectionState.selections, [selectionState])
  const typedSelected =
    communityTrigger !== null && selectionState.selections.has(`&${communityTrigger.query}`)
  const community = useNativeChatCommunitySkills({
    query: typedSelected ? null : (communityTrigger?.query ?? null),
    targetKey: communityTarget,
    agent,
    api: getCommunitySkillsApi()
  })
  const owner = useRef<object | null>(null)
  useLayoutEffect(() => {
    owner.current = {}
    return () => {
      owner.current = null
    }
  }, [communityTarget])
  const listboxId = `native-chat-picker-${useId().replaceAll(':', '')}`
  const dismissalContext = `${communityTarget}:${agent}`
  const [dismissed, setDismissed] = useState<{ context: string; triggerKey: string } | null>(null)
  const skillOriginRef = useRef<string | null>(null)
  const lastOpenKeyRef = useRef<string | null>(null)
  const autocomplete = useMemo(
    () =>
      typedSelected
        ? { mode: 'none' as const }
        : (deriveCommunitySkillAutocomplete(
            draft,
            caret,
            community,
            dismissed?.context === dismissalContext ? dismissed.triggerKey : null
          ) ??
          deriveComposerAutocomplete(
            draft,
            caret,
            agentCommands,
            discovery.skills,
            profile,
            discovery,
            dismissed?.context === dismissalContext ? dismissed.triggerKey : null,
            sessionSkillNames
          )),
    [
      agentCommands,
      community,
      typedSelected,
      caret,
      dismissalContext,
      dismissed,
      discovery,
      draft,
      profile,
      sessionSkillNames
    ]
  )

  useEffect(() => {
    // Why: suppression is per-trigger-occurrence AND per-context. The composer
    // is reused across pane/agent switches, so a stale dismissal must clear or
    // the picker stays closed for an in-progress token when that context returns.
    skillOriginRef.current = null
    setDismissed(null)
  }, [dismissalContext])

  useEffect(() => {
    if (autocomplete.mode !== 'slash') {
      lastOpenKeyRef.current = null
      return
    }
    const openKey = `${dismissalContext}:${autocomplete.triggerKey}`
    if (lastOpenKeyRef.current !== openKey) {
      lastOpenKeyRef.current = openKey
      if (autocomplete.prefix === '/') {
        emitNativeChatPickerOpened({ agent, prefix: autocomplete.prefix })
      }
    }
  }, [agent, autocomplete, dismissalContext])

  const completeItem = useCallback(
    (item: NativeChatPickerItem) => {
      if (autocomplete.mode !== 'slash') {
        return
      }
      const result = applyPickerSuggestion(draft, caret, item)
      if (item.kind === 'skill' && textareaRef.current?.insertSkill) {
        const from = result.caret - result.insertedToken.length - 1
        textareaRef.current.insertSkill(from, caret, result.insertedToken)
      }
      if (!result.insertedToken) {
        return
      }
      if (item.kind === 'community-skill') {
        const previous = selectionState.selections.get(item.token)
        if (
          previous &&
          (previous.id !== item.metadata.id || previous.digest !== item.metadata.digest)
        ) {
          selectionState.ambiguousTokens.add(item.token)
          selectionState.selections.delete(item.token)
        } else if (!selectionState.ambiguousTokens.has(item.token)) {
          setBoundedScopeCacheEntry(selectionState.selections, item.token, item.metadata)
        }
      }
      setDraft(result.draft)
      setCaret(result.caret)
      setActiveSuggestion(0)
      setDismissed(null)
      skillOriginRef.current = item.kind === 'skill' ? result.insertedToken : null
      if (item.kind !== 'community-skill') {
        emitNativeChatPickerItemAccepted({ agent, itemKind: item.kind })
      }
      const textarea = textareaRef.current
      const requestOwner = owner.current
      textarea?.focus()
      requestAnimationFrame(() => {
        if (
          requestOwner !== null &&
          owner.current === requestOwner &&
          textareaRef.current === textarea
        ) {
          textarea?.setSelectionRange(result.caret, result.caret)
        }
      })
    },
    [
      agent,
      autocomplete,
      caret,
      draft,
      selectionState,
      setActiveSuggestion,
      setCaret,
      setDraft,
      textareaRef
    ]
  )

  const handleDraftOrCaretChange = useCallback(
    (value: string, nextCaret: number) => {
      const firstToken = value.split(/\s/, 1)[0] ?? ''
      if (skillOriginRef.current && firstToken !== skillOriginRef.current) {
        skillOriginRef.current = null
      }
      if (!dismissed || dismissed.context !== dismissalContext) {
        return
      }
      // Why: a single edit that replaces the dismissed token wholesale (e.g.
      // select-all + paste) is a new trigger occurrence even though a trigger
      // character lands back on the same draft position.
      if (editReplacesTriggerToken(draft, value, dismissed.triggerKey)) {
        setDismissed(null)
        return
      }
      const next =
        deriveCommunitySkillAutocomplete(value, nextCaret, community, null) ??
        deriveComposerAutocomplete(
          value,
          nextCaret,
          agentCommands,
          discovery.skills,
          profile,
          discovery,
          null,
          sessionSkillNames
        )
      if (next.mode !== 'slash' || next.triggerKey !== dismissed.triggerKey) {
        setDismissed(null)
      }
    },
    [
      agentCommands,
      community,
      dismissalContext,
      dismissed,
      discovery,
      draft,
      profile,
      sessionSkillNames
    ]
  )

  const classifySend = useCallback(
    (value: string) => {
      const outcome = classifyNativeChatSend(
        value,
        agentCommands,
        skillOriginRef.current,
        profile?.skillPrefix ?? null
      )
      emitNativeChatSendClassified({ agent, outcome })
      return outcome
    },
    [agent, agentCommands, profile]
  )
  const clearSkillOrigin = useCallback(() => {
    skillOriginRef.current = null
  }, [])
  const dismiss = useCallback(
    (triggerKey: string) => setDismissed({ context: dismissalContext, triggerKey }),
    [dismissalContext]
  )

  return {
    autocomplete,
    listboxId,
    retrySkills:
      autocomplete.mode === 'slash' && autocomplete.prefix === '&'
        ? community.retry
        : discovery.retry,
    readCommunitySelections,
    classifySend,
    clearSkillOrigin,
    completeItem,
    dismiss,
    handleDraftOrCaretChange
  }
}
