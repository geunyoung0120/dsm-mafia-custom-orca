import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  COMMUNITY_SKILL_BODY_MAX_BYTES,
  communitySkillCredentialsSchema,
  communitySkillMetadataSchema,
  communitySkillPublishSchema,
  communitySkillReferenceSchema,
  communitySkillSearchResultSchema,
  communitySkillSearchSchema,
  communitySkillVersionSchema,
  type CommunitySkillCredentials,
  type CommunitySkillPublishInput,
  type CommunitySkillReference,
  type CommunitySkillsStatus
} from '../../shared/community-skills'
import { readFetchResponseJsonWithinLimit } from '../../shared/fetch-response-body'

const loginSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  author: z.string().min(3).max(32)
})
const okSchema = z.object({ ok: z.literal(true) })
const idSchema = z.object({ id: z.uuid() })

export class CommunitySkillsClient {
  private token: string | null = null
  private author: string | null = null
  private authGeneration = 0
  private readonly origin: string

  constructor(
    origin: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    const url = new URL(origin)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('Community skills require a fixed HTTPS service origin.')
    }
    this.origin = url.origin
  }

  status(): CommunitySkillsStatus {
    return { configured: true, author: this.author }
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    authenticated = false,
    token = this.token
  ): Promise<T> {
    if (authenticated && !token) {
      throw new Error('Sign in to publish or manage community skills.')
    }
    try {
      const response = await this.fetcher(`${this.origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(authenticated && token ? { authorization: `Bearer ${token}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(15000)
      })
      if (!response.ok) {
        await response.body?.cancel()
        if (response.status === 401) {
          if (authenticated && token === this.token) {
            this.authGeneration += 1
            this.token = null
            this.author = null
          }
          throw new Error('Sign in again. The username, password or session was not accepted.')
        }
        if (response.status === 404) {
          throw new Error(
            'This skill version is unavailable. Refresh the catalog and select it again.'
          )
        }
        if (response.status === 409) {
          throw new Error('This username is unavailable.')
        }
        if (response.status === 429) {
          throw new Error('Community skill request or storage limit reached. Try again later.')
        }
        if (response.status === 400 || response.status === 413 || response.status === 415) {
          throw new Error(
            'Invalid skill request. Only standalone Markdown instructions up to 64 KiB are supported.'
          )
        }
        throw new Error('Community skills are temporarily unavailable. Try again later.')
      }
      const value = await readFetchResponseJsonWithinLimit(response, 256 * 1024)
      const parsed = schema.safeParse(value)
      if (!parsed.success) {
        throw new Error('The community skill service returned invalid data.')
      }
      return parsed.data
    } catch (error) {
      if (
        error instanceof Error &&
        /^(Sign in|This |Community |Invalid skill|The community)/.test(error.message)
      ) {
        throw error
      }
      throw new Error('Community skills are temporarily unavailable. Try again later.')
    }
  }

  async search(input: z.infer<typeof communitySkillSearchSchema>) {
    const parsed = communitySkillSearchSchema.parse(input)
    const params = new URLSearchParams({
      query: parsed.query ?? '',
      offset: String(parsed.offset ?? 0)
    })
    return this.request(`/skills?${params}`, communitySkillSearchResultSchema)
  }

  async readVersion(input: CommunitySkillReference) {
    const parsed = communitySkillReferenceSchema.parse(input)
    const value = await this.request(
      `/skills/${parsed.id}/versions/${parsed.version}`,
      communitySkillVersionSchema
    )
    if (
      value.id !== parsed.id ||
      value.version !== parsed.version ||
      Buffer.byteLength(value.body, 'utf8') > COMMUNITY_SKILL_BODY_MAX_BYTES ||
      createHash('sha256').update(value.body, 'utf8').digest('hex') !== value.digest
    ) {
      throw new Error(
        'The community skill version or digest did not match. Select the skill again.'
      )
    }
    return value
  }

  private async authenticate(
    path: '/auth/register' | '/auth/login',
    input: CommunitySkillCredentials
  ) {
    const generation = ++this.authGeneration
    const value = await this.request(
      path,
      loginSchema,
      communitySkillCredentialsSchema.parse(input)
    )
    if (generation !== this.authGeneration) {
      await this.request('/auth/logout', okSchema, {}, true, value.token).catch(() => undefined)
      throw new Error('Sign in was cancelled. Please retry.')
    }
    this.token = value.token
    this.author = value.author
    return this.status()
  }
  register(input: CommunitySkillCredentials) {
    return this.authenticate('/auth/register', input)
  }
  login(input: CommunitySkillCredentials) {
    return this.authenticate('/auth/login', input)
  }
  async logout(): Promise<void> {
    const token = this.token
    this.authGeneration += 1
    this.token = null
    this.author = null
    if (token) {
      await this.request('/auth/logout', okSchema, {}, true, token)
    }
  }
  async publish(input: CommunitySkillPublishInput) {
    const parsed = communitySkillPublishSchema.parse(input)
    if (Buffer.byteLength(parsed.body, 'utf8') > COMMUNITY_SKILL_BODY_MAX_BYTES) {
      throw new Error('Invalid skill body size.')
    }
    return this.request('/skills', communitySkillMetadataSchema, parsed, true)
  }
  async hide(input: { id: string }): Promise<void> {
    const parsed = idSchema.parse(input)
    await this.request(`/skills/${parsed.id}/hide`, okSchema, {}, true)
  }
  async report(input: { id: string; reason: string }): Promise<void> {
    const parsed = idSchema.extend({ reason: z.string().trim().min(1).max(1000) }).parse(input)
    await this.request(`/skills/${parsed.id}/report`, okSchema, { reason: parsed.reason }, true)
  }
}
