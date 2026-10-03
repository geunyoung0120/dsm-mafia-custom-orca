import type { CommunitySkillMetadata } from '../../../../shared/community-skills'
import { setBoundedScopeCacheEntry } from './native-chat-composer-scope-cache'

type SelectionState = {
  selections: Map<string, CommunitySkillMetadata>
  ambiguousTokens: Set<string>
}
const cache = new Map<string, SelectionState>()

// Metadata pins survive a TUI/GUI toggle alongside its cached draft; bodies are never cached here.
export function readCommunitySkillSelectionState(targetKey: string): SelectionState {
  const state = cache.get(targetKey) ?? {
    selections: new Map(),
    ambiguousTokens: new Set<string>()
  }
  setBoundedScopeCacheEntry(cache, targetKey, state)
  return state
}
