import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { CommunitySkillsApi } from '../../../../shared/community-skills'
import {
  communitySkillReferences,
  resolveCommunitySkillMessage,
  withCommunitySkillTimeout,
  type CommunitySkillSelections
} from '@/lib/community-skill-invocation'

export function useNativeChatCommunitySkillSend(args: {
  targetKey: string
  draft: string
  attachments: readonly { path: string }[]
  agent: AgentType
  selections: () => CommunitySkillSelections
  api?: Pick<CommunitySkillsApi, 'readVersion'>
  isComposing?: () => boolean
}) {
  const compositionKey = JSON.stringify([args.targetKey, args.agent, args.draft, args.attachments])
  const owner = useRef<object | null>(null)
  const inFlight = useRef<object | null>(null)
  const [state, setState] = useState<{
    key: string
    owner: object | null
    pending: boolean
    error: string | null
  }>({
    key: compositionKey,
    owner: null,
    pending: false,
    error: null
  })
  useLayoutEffect(() => {
    owner.current = {}
    inFlight.current = null
    return () => {
      owner.current = null
      inFlight.current = null
    }
  }, [compositionKey])
  const cancel = useCallback(() => {
    owner.current = {}
    inFlight.current = null
    setState({ key: compositionKey, owner: owner.current, pending: false, error: null })
  }, [compositionKey])
  const send = useCallback(
    (text: string, dispatch: (text: string) => void): void => {
      if (inFlight.current || args.isComposing?.()) {
        return
      }
      if (communitySkillReferences(text).length === 0) {
        dispatch(text)
        return
      }
      const requestOwner = owner.current
      if (!requestOwner) {
        return
      }
      const request = {}
      inFlight.current = request
      setState({ key: compositionKey, owner: requestOwner, pending: true, error: null })
      const isCurrent = (): boolean =>
        owner.current === requestOwner && inFlight.current === request
      void withCommunitySkillTimeout(
        resolveCommunitySkillMessage(text, new Map(args.selections()), args.agent, args.api)
      )
        .then((resolved) => {
          if (!isCurrent()) {
            return
          }
          if (args.isComposing?.()) {
            throw new Error('Input changed while loading skills. Retry sending.')
          }
          dispatch(resolved)
        })
        .catch((error: unknown) => {
          if (!isCurrent()) {
            return
          }
          setState({
            key: compositionKey,
            owner: requestOwner,
            pending: false,
            error:
              error instanceof Error
                ? error.message
                : 'Could not load community skills. Retry sending.'
          })
        })
        .finally(() => {
          if (!isCurrent()) {
            return
          }
          inFlight.current = null
          setState((previous) => ({ ...previous, pending: false }))
        })
    },
    [args, compositionKey]
  )
  // Text can revert to a prior key; request identity must not revert with it.
  const currentState = state.key === compositionKey && state.owner === owner.current
  return {
    send,
    cancel,
    pending: currentState && state.pending,
    error: currentState ? state.error : null
  }
}
