import { useState, type ComponentProps } from 'react'
import { CommunitySkillsDialog } from '@/components/community-skills/CommunitySkillsDialog'
import {
  communitySkillMetadataSchema,
  type CommunitySkillMetadata
} from '../../../../shared/community-skills'
import type { AgentType } from '../../../../shared/agent-status-types'
import { NativeChatPickerMenu } from './NativeChatAutocompleteMenus'
import { buildCommunitySkillPickerItem } from './native-chat-community-picker'

export function NativeChatCommunityPicker({
  agent,
  ...props
}: ComponentProps<typeof NativeChatPickerMenu> & { agent?: AgentType }): React.JSX.Element {
  const [preview, setPreview] = useState<CommunitySkillMetadata | null>(null)
  return (
    <>
      <NativeChatPickerMenu {...props} onPreview={(item) => setPreview(item.metadata)} />
      {preview ? (
        <CommunitySkillsDialog
          initialSkill={preview}
          initialVersion={preview.version}
          agent={agent}
          onOpenChange={(open) => {
            if (!open) {
              setPreview(null)
            }
          }}
          onChoose={(version) => {
            props.onChoose(
              buildCommunitySkillPickerItem(communitySkillMetadataSchema.parse(version))
            )
            setPreview(null)
          }}
        />
      ) : null}
    </>
  )
}
