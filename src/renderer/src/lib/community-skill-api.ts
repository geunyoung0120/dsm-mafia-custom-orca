import type { CommunitySkillsApi } from '../../../shared/community-skills'

export function getCommunitySkillsApi(): CommunitySkillsApi | undefined {
  // Optional bridge keeps older desktop and web clients usable during rollout.
  return window.api?.skills?.community
}
