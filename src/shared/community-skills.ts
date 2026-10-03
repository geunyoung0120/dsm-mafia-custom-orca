import { z } from 'zod'

export const COMMUNITY_SKILL_BODY_MAX_BYTES = 64 * 1024
export const COMMUNITY_SKILL_SUPPORTED_AGENTS = ['codex', 'claude', 'openclaude', 'grok'] as const

export const communitySkillMetadataSchema = z.object({
  id: z.uuid(),
  author: z.string().min(3).max(32),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  description: z.string().max(500),
  version: z.number().int().positive(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  supportedAgents: z.array(z.enum(COMMUNITY_SKILL_SUPPORTED_AGENTS)).min(1).max(4),
  updatedAt: z.string()
})
export const communitySkillVersionSchema = communitySkillMetadataSchema.extend({
  body: z.string().min(1).max(COMMUNITY_SKILL_BODY_MAX_BYTES)
})
export const communitySkillReferenceSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive()
})
export const communitySkillPublishSchema = z.object({
  skillId: z.uuid().optional(),
  name: communitySkillMetadataSchema.shape.name,
  description: communitySkillMetadataSchema.shape.description,
  body: communitySkillVersionSchema.shape.body,
  supportedAgents: communitySkillMetadataSchema.shape.supportedAgents
})
export const communitySkillCredentialsSchema = z.object({
  username: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,31}$/),
  password: z.string().min(12).max(256)
})
export const communitySkillSearchSchema = z.object({
  query: z.string().max(100).optional(),
  offset: z.number().int().min(0).max(10000).optional()
})
export const communitySkillSearchResultSchema = z.object({
  items: z.array(communitySkillMetadataSchema).max(20),
  hasMore: z.boolean()
})

export type CommunitySkillMetadata = z.infer<typeof communitySkillMetadataSchema>
export type CommunitySkillVersion = z.infer<typeof communitySkillVersionSchema>
export type CommunitySkillReference = z.infer<typeof communitySkillReferenceSchema>
export type CommunitySkillPublishInput = z.infer<typeof communitySkillPublishSchema>
export type CommunitySkillCredentials = z.infer<typeof communitySkillCredentialsSchema>
export type CommunitySkillSearchResult = z.infer<typeof communitySkillSearchResultSchema>
export type CommunitySkillsStatus = { configured: boolean; author: string | null }

export type CommunitySkillsApi = {
  status: () => Promise<CommunitySkillsStatus>
  search: (input: z.infer<typeof communitySkillSearchSchema>) => Promise<CommunitySkillSearchResult>
  readVersion: (input: CommunitySkillReference) => Promise<CommunitySkillVersion>
  register: (input: CommunitySkillCredentials) => Promise<CommunitySkillsStatus>
  login: (input: CommunitySkillCredentials) => Promise<CommunitySkillsStatus>
  logout: () => Promise<void>
  publish: (input: CommunitySkillPublishInput) => Promise<CommunitySkillMetadata>
  hide: (input: { id: string }) => Promise<void>
  report: (input: { id: string; reason: string }) => Promise<void>
}
