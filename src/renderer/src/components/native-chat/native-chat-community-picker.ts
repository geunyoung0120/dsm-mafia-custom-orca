import type { CommunitySkillMetadata } from '../../../../shared/community-skills'
import { stripUnsafeDisplayCharacters } from '../../../../shared/skill-display-text'
import type { NativeChatPickerItem } from './native-chat-picker-items'
import { communitySkillToken, findCommunitySkillTrigger } from '@/lib/community-skill-invocation'
import type { ComposerAutocomplete } from './native-chat-composer-state'
import type { useNativeChatCommunitySkills } from './use-native-chat-community-skills'

export function deriveCommunitySkillAutocomplete(
  draft: string,
  caret: number,
  discovery: ReturnType<typeof useNativeChatCommunitySkills>,
  dismissedTriggerKey: string | null
): ComposerAutocomplete | null {
  const trigger = findCommunitySkillTrigger(draft, caret)
  if (!trigger) {
    return null
  }
  const triggerKey = `&:${trigger.position}`
  if (triggerKey === dismissedTriggerKey) {
    return { mode: 'none' }
  }
  return {
    mode: 'slash',
    prefix: '&',
    query: trigger.query,
    triggerKey,
    dispatchable: false,
    grouped: false,
    commandsEnabled: false,
    skillsEnabled: true,
    items: discovery.items,
    skillStatus: discovery.status,
    ...(discovery.errorKind ? { skillErrorKind: discovery.errorKind } : {}),
    ...(discovery.error ? { skillError: discovery.error } : {})
  }
}

export function buildCommunitySkillPickerItem(
  metadata: CommunitySkillMetadata
): Extract<NativeChatPickerItem, { kind: 'community-skill' }> {
  return {
    kind: 'community-skill',
    id: `community:${metadata.id}@${metadata.version}`,
    name: `${metadata.author}/${metadata.name}`,
    token: communitySkillToken(metadata),
    description: stripUnsafeDisplayCharacters(metadata.description).slice(0, 240),
    metadata
  }
}
