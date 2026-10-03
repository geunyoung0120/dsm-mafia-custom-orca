// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  CommunitySkillMetadata,
  CommunitySkillVersion
} from '../../../../shared/community-skills'
import type { ComposerAutocomplete } from './native-chat-composer-state'
import { NativeChatCommunityPicker } from './NativeChatCommunityPicker'
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
vi.mock('@/components/community-skills/CommunitySkillsDialog', () => ({
  CommunitySkillsDialog: ({
    initialSkill,
    initialVersion,
    agent,
    onChoose
  }: {
    initialSkill: CommunitySkillMetadata
    initialVersion: number
    agent: string
    onChoose: (version: CommunitySkillVersion) => void
  }) => (
    <button onClick={() => onChoose({ ...initialSkill, version: 2, body: 'Preview only' })}>
      Preview {initialSkill.author}/{initialSkill.name}@{initialVersion} for {agent}
    </button>
  )
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
afterEach(cleanup)
it('opens exact first-use version preview beside the qualified author, and chooses metadata without retaining the preview body', () => {
  const autocomplete: Extract<ComposerAutocomplete, { mode: 'slash' }> = {
    mode: 'slash',
    prefix: '&',
    query: '',
    triggerKey: '&:0',
    dispatchable: false,
    grouped: false,
    commandsEnabled: false,
    skillsEnabled: true,
    skillStatus: 'ready',
    items: [
      {
        kind: 'community-skill',
        id: metadata.id,
        name: 'alice/review',
        token: '&alice/review@3',
        description: metadata.description,
        metadata
      }
    ]
  }
  const choose = vi.fn()
  const view = render(
    <NativeChatCommunityPicker
      autocomplete={autocomplete}
      activeIndex={0}
      listboxId="picker"
      agent="codex"
      onChoose={choose}
      onRetry={vi.fn()}
    />
  )
  expect(view.queryByText('Preview alice/review@3 for codex')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Preview &alice/review@3' }))
  fireEvent.click(view.getByText('Preview alice/review@3 for codex'))
  expect(choose).toHaveBeenCalledOnce()
  expect(choose.mock.calls[0]?.[0]).toMatchObject({
    kind: 'community-skill',
    token: '&alice/review@2',
    metadata: { id: metadata.id, version: 2 }
  })
  expect(choose.mock.calls[0]?.[0].metadata).not.toHaveProperty('body')
})
