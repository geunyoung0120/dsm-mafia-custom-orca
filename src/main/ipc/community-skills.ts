import { CommunitySkillsClient } from '../skills/community-skills-client'
import { COMMUNITY_SKILLS_SERVICE_URL } from '../../shared/community-skills-service'
import type {
  CommunitySkillCredentials,
  CommunitySkillPublishInput,
  CommunitySkillReference
} from '../../shared/community-skills'
import { handleMainWindowSkillIpc } from './skill-ipc-main-window'

export function registerCommunitySkillsHandlers(): void {
  const client = new CommunitySkillsClient(COMMUNITY_SKILLS_SERVICE_URL)
  handleMainWindowSkillIpc('community-skills:status', () => client.status())
  handleMainWindowSkillIpc(
    'community-skills:search',
    (_event, input: { query?: string; offset?: number }) => client.search(input)
  )
  handleMainWindowSkillIpc(
    'community-skills:readVersion',
    (_event, input: CommunitySkillReference) => client.readVersion(input)
  )
  handleMainWindowSkillIpc(
    'community-skills:register',
    (_event, input: CommunitySkillCredentials) => client.register(input)
  )
  handleMainWindowSkillIpc('community-skills:login', (_event, input: CommunitySkillCredentials) =>
    client.login(input)
  )
  handleMainWindowSkillIpc('community-skills:logout', () => client.logout())
  handleMainWindowSkillIpc(
    'community-skills:publish',
    (_event, input: CommunitySkillPublishInput) => client.publish(input)
  )
  handleMainWindowSkillIpc('community-skills:hide', (_event, input: { id: string }) =>
    client.hide(input)
  )
  handleMainWindowSkillIpc(
    'community-skills:report',
    (_event, input: { id: string; reason: string }) => client.report(input)
  )
}
