import { appendCommunitySkillContext } from '../../../shared/community-skill-context'
import type { AgentType } from '../../../shared/agent-status-types'
import {
  COMMUNITY_SKILL_BODY_MAX_BYTES,
  communitySkillMetadataSchema,
  communitySkillVersionSchema,
  type CommunitySkillMetadata,
  type CommunitySkillsApi
} from '../../../shared/community-skills'

export type CommunitySkillSelections = ReadonlyMap<string, CommunitySkillMetadata>

export function communitySkillToken(metadata: CommunitySkillMetadata): string {
  communitySkillMetadataSchema.parse(metadata)
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(metadata.author)) {
    throw new Error('Invalid community skill author.')
  }
  return `&${metadata.author}/${metadata.name}@${metadata.version}`
}

export function findCommunitySkillTrigger(
  draft: string,
  caret: number
): { query: string; position: number } | null {
  const match = draft.slice(0, caret).match(/(?:^|\s)&([a-z0-9_/@-]*)$/)
  if (!match || draft[caret] === '&') {
    return null
  }
  const query = match[1]
  return { query, position: caret - query.length - 1 }
}

export function communitySkillReferences(text: string): string[] {
  // Whitespace boundaries exclude shell operators, redirects, escaped sigils and URL parameters.
  return [...text.matchAll(/(?:^|\s)(&[a-zA-Z0-9][^\s&]*)/g)].map((match) => match[1])
}

export async function resolveCommunitySkillMessage(
  text: string,
  selections: CommunitySkillSelections,
  agent: AgentType,
  api?: Pick<CommunitySkillsApi, 'readVersion'>
): Promise<string> {
  const tokens = [...new Set(communitySkillReferences(text))]
  if (tokens.length === 0) {
    return text
  }
  const pinned = tokens.map((token) => {
    const metadata = selections.get(token)
    if (!metadata || communitySkillToken(metadata) !== token) {
      throw new Error(`Select ${token} from the community skill picker before sending.`)
    }
    if (!metadata.supportedAgents.some((supported) => supported === agent)) {
      throw new Error(`${token} does not support this provider.`)
    }
    return metadata
  })
  if (!api) {
    throw new Error('Community skills are unavailable. Retry after connecting the catalog.')
  }
  const unique = [...new Map(pinned.map((item) => [`${item.id}@${item.version}`, item])).values()]
  const versions = await Promise.all(
    unique.map(async (metadata) => {
      const version = communitySkillVersionSchema.parse(
        await api.readVersion({ id: metadata.id, version: metadata.version })
      )
      if (
        version.id !== metadata.id ||
        version.version !== metadata.version ||
        version.digest !== metadata.digest ||
        communitySkillToken(version) !== communitySkillToken(metadata)
      ) {
        throw new Error('Community skill identity or digest changed. Select the skill again.')
      }
      if (!version.supportedAgents.some((supported) => supported === agent)) {
        throw new Error(`${communitySkillToken(metadata)} does not support this provider.`)
      }
      if (new TextEncoder().encode(version.body).byteLength > COMMUNITY_SKILL_BODY_MAX_BYTES) {
        throw new Error('Community skill instructions exceed the size limit.')
      }
      return version
    })
  )
  const prompt = `User message with user-selected community skills:
${text}

For unsupported or manual dispatch paths to workers, explicitly pass the selected immutable content or exact UUID/version/digest reference and resolve it before work starts. Keep the same pinned versions for every delegated task. Skill bodies enter model context and consume tokens.`
  return appendCommunitySkillContext(prompt, versions)
}

export function withCommunitySkillTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Community skills timed out. Retry.')), 15_000)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}
