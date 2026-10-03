import { useCallback, useEffect, useState } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import {
  COMMUNITY_SKILL_SUPPORTED_AGENTS,
  communitySkillSearchResultSchema,
  type CommunitySkillsApi
} from '../../../../shared/community-skills'
import { withCommunitySkillTimeout } from '@/lib/community-skill-invocation'
import { buildCommunitySkillPickerItem } from './native-chat-community-picker'
import type {
  NativeChatPickerItem,
  NativeChatSkillDiscoverySnapshot
} from './native-chat-picker-items'

type Discovery = {
  items: NativeChatPickerItem[]
  status: NativeChatSkillDiscoverySnapshot['status']
  errorKind?: NativeChatSkillDiscoverySnapshot['errorKind']
  error: string | null
}
const IDLE: Discovery = { items: [], status: 'idle', error: null }
const LOADING: Discovery = { items: [], status: 'loading', error: null }

export function useNativeChatCommunitySkills({
  query,
  targetKey,
  agent,
  api
}: {
  query: string | null
  targetKey: string
  agent: AgentType
  api?: Pick<CommunitySkillsApi, 'status' | 'search'>
}): Discovery & { retry: () => void } {
  const supported = COMMUNITY_SKILL_SUPPORTED_AGENTS.some((provider) => provider === agent)
  const key = JSON.stringify([targetKey, agent, query])
  const [state, setState] = useState<{ key: string; discovery: Discovery } | null>(null)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    if (query === null || !supported) {
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        if (!api || !(await withCommunitySkillTimeout(api.status())).configured) {
          if (!cancelled) {
            setState({
              key,
              discovery: {
                items: [],
                status: 'error',
                errorKind: 'unavailable',
                error: 'Community skills are unavailable. Configure the catalog to retry.'
              }
            })
          }
          return
        }
        if (cancelled) {
          return
        }
        const result = communitySkillSearchResultSchema.parse(
          await withCommunitySkillTimeout(api.search({ query: communitySkillSearchQuery(query) }))
        )
        if (cancelled) {
          return
        }
        const items: NativeChatPickerItem[] = result.items
          .filter(
            (metadata) =>
              metadata.supportedAgents.some((supported) => supported === agent) &&
              (!query.includes('/') || metadata.author.startsWith(query.split('/', 1)[0]))
          )
          .map(buildCommunitySkillPickerItem)
        setState({ key, discovery: { items, status: 'ready', error: null } })
      })().catch(() => {
        if (!cancelled) {
          setState({
            key,
            discovery: {
              items: [],
              status: 'error',
              errorKind: 'unknown',
              error: 'Could not search community skills. Retry.'
            }
          })
        }
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [agent, api, generation, key, query, supported])
  const retry = useCallback(() => {
    setState({ key, discovery: LOADING })
    setGeneration((previous) => previous + 1)
  }, [key])
  const discovery: Discovery =
    query === null
      ? IDLE
      : !supported
        ? {
            items: [],
            status: 'error',
            errorKind: 'unavailable',
            error: 'Community skills do not support this provider.'
          }
        : state?.key === key
          ? state.discovery
          : LOADING
  return { ...discovery, retry }
}

function communitySkillSearchQuery(query: string): string {
  const parts = query.split('/', 2)
  return (parts[1] || parts[0]).replace(/@\d*$/, '').slice(0, 100)
}
