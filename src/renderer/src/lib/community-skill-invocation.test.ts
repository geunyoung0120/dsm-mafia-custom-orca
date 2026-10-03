import { readCommunitySkillContext } from '../../../shared/community-skill-context'
import { describe, expect, it, vi } from 'vitest'
import type { CommunitySkillMetadata, CommunitySkillsApi } from '../../../shared/community-skills'
import {
  communitySkillToken,
  findCommunitySkillTrigger,
  resolveCommunitySkillMessage
} from './community-skill-invocation'

export const metadata: CommunitySkillMetadata = {
  id: 'f51fdd2a-a156-4b54-932d-177b941a4455',
  author: 'alice',
  name: 'review',
  description: 'Review code',
  version: 3,
  digest: 'a'.repeat(64),
  supportedAgents: ['codex', 'claude'],
  updatedAt: '2026-10-04'
}
const token = '&alice/review@3'
const selections = new Map([[token, metadata]])
function api(readVersion: CommunitySkillsApi['readVersion']) {
  return { readVersion }
}

describe('community invocation grammar', () => {
  it.each(['&&', 'run && foo', 'foo&review', 'https://a/?q=x&review', 'echo &>file', 'echo 2>&1'])(
    'ignores shell/URL syntax %s',
    (draft) => {
      expect(findCommunitySkillTrigger(draft, draft.length)).toBeNull()
    }
  )
  it('requires a standalone sigil and tolerates a qualified pinned query', () => {
    expect(findCommunitySkillTrigger('use &alice/review@3', 19)).toMatchObject({
      query: 'alice/review@3',
      position: 4
    })
    expect(findCommunitySkillTrigger('&&', 1)).toBeNull()
    expect(communitySkillToken(metadata)).toBe(token)
  })
})

describe('send-time resolution', () => {
  it('pins UUID/version, accepts typed selected references and attaches each body once as user instructions', async () => {
    const readVersion = vi.fn(async () => ({ ...metadata, body: 'Immutable instructions' }))
    const text = await resolveCommunitySkillMessage(
      `use ${token} and ${token}`,
      selections,
      'codex',
      api(readVersion)
    )
    expect(readVersion).toHaveBeenCalledExactlyOnceWith({ id: metadata.id, version: 3 })
    expect(text).toContain(metadata.id)
    expect(text).toContain(metadata.digest)
    expect(text).toContain('user-selected')
    expect(text).toContain('workers')
    expect(text).toContain('manual')
    expect(text.match(/Immutable instructions/g)).toHaveLength(1)
    expect(readCommunitySkillContext(text)).toEqual([
      { ...metadata, body: 'Immutable instructions' }
    ])
  })
  it.each(['&review', '&alice/review@4', '&alice/review@3suffix'])(
    'blocks unresolved %s without reading any latest version',
    async (text) => {
      const readVersion = vi.fn()
      await expect(
        resolveCommunitySkillMessage(text, selections, 'codex', api(readVersion))
      ).rejects.toThrow(/select/i)
      expect(readVersion).not.toHaveBeenCalled()
    }
  )
  it('leaves normal prose and shell && unchanged without an API', async () => {
    expect(await resolveCommunitySkillMessage('echo a && echo b', selections, 'codex')).toBe(
      'echo a && echo b'
    )
  })
  it('fails closed on unavailable service, hidden/deleted versions, incompatible providers, and mismatched identity/digest', async () => {
    await expect(resolveCommunitySkillMessage(token, selections, 'codex')).rejects.toThrow(
      /unavailable/i
    )
    await expect(
      resolveCommunitySkillMessage(token, selections, 'grok', api(vi.fn()))
    ).rejects.toThrow(/support/i)
    await expect(
      resolveCommunitySkillMessage(
        token,
        selections,
        'codex',
        api(async () => {
          throw new Error('Hidden version')
        })
      )
    ).rejects.toThrow('Hidden version')
    for (const changed of [
      { version: 4 },
      { id: '844a9d41-954f-4d87-9644-c60b2d47ce90' },
      { digest: 'b'.repeat(64) },
      { supportedAgents: ['grok'] as const }
    ]) {
      const readVersion = vi.fn(async () => ({
        ...metadata,
        body: 'Instructions',
        ...changed,
        supportedAgents: [...(changed.supportedAgents ?? metadata.supportedAgents)]
      }))
      await expect(
        resolveCommunitySkillMessage(token, selections, 'codex', api(readVersion))
      ).rejects.toThrow()
    }
  })
})

it('resolves numeric-leading qualified handles and leaves standalone ampersands as literal prose/shell', async () => {
  const numeric = { ...metadata, author: '123', name: 'alice' }
  const token = '&123/alice@3'
  const readVersion = vi.fn(async () => ({ ...numeric, body: 'Numeric author instructions' }))
  const text = await resolveCommunitySkillMessage(token, new Map([[token, numeric]]), 'codex', {
    readVersion
  })
  expect(readVersion).toHaveBeenCalledExactlyOnceWith({ id: numeric.id, version: 3 })
  expect(text).toContain('Numeric author instructions')
  for (const prose of ['&', 'a & b', 'echo a &', 'echo a && echo b']) {
    expect(await resolveCommunitySkillMessage(prose, new Map(), 'codex')).toBe(prose)
  }
})
