import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { CommunitySkillsClient } from './community-skills-client'

const id = '9f048ca0-e1e3-4faf-920f-7847c2e6207f'
const body = '# Review\nCheck correctness.'
const metadata = {
  id,
  author: 'alice',
  name: 'review',
  description: '',
  version: 2,
  digest: createHash('sha256').update(body).digest('hex'),
  supportedAgents: ['codex'],
  updatedAt: '2026-10-04T00:00:00Z'
}

describe('community skill HTTPS client', () => {
  it('a late login cannot undo logout', async () => {
    let finishLogin: (response: Response) => void = () => undefined
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLogin = resolve
          })
      )
      .mockResolvedValue(Response.json({ ok: true }))
    const client = new CommunitySkillsClient('https://skills.example', fetcher)
    const pending = client.login({ username: 'alice', password: 'long password here' })
    const rejected = expect(pending).rejects.toThrow('cancelled')
    await client.logout()
    finishLogin(Response.json({ token: 'a'.repeat(43), author: 'alice' }))
    await rejected
    expect(client.status().author).toBeNull()
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      authorization: `Bearer ${'a'.repeat(43)}`
    })
  })
  it('overlapping logins preserve the latest account intent', async () => {
    const completions: ((response: Response) => void)[] = []
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          completions.push(resolve)
        })
    )
    const client = new CommunitySkillsClient('https://skills.example', fetcher)
    const first = client.login({ username: 'alice', password: 'long password here' })
    const rejected = expect(first).rejects.toThrow('cancelled')
    const second = client.login({ username: 'bob', password: 'another password here' })
    completions[1](Response.json({ token: 'b'.repeat(43), author: 'bob' }))
    await second
    fetcher.mockResolvedValue(Response.json({ ok: true }))
    completions[0](Response.json({ token: 'a'.repeat(43), author: 'alice' }))
    await rejected
    expect(client.status().author).toBe('bob')
  })
  it('fetches exact pinned version and verifies digest', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...metadata, body }))
    const client = new CommunitySkillsClient('https://skills.example', fetcher)
    expect(await client.readVersion({ id, version: 2 })).toEqual({ ...metadata, body })
    expect(fetcher.mock.calls[0][0]).toBe(`https://skills.example/skills/${id}/versions/2`)
    expect(fetcher.mock.calls[0][1]?.redirect).toBe('error')
  })
  it('rejects a mismatched identity, version or digest', async () => {
    for (const altered of [
      { version: 3 },
      { id: '3f048ca0-e1e3-4faf-920f-7847c2e6207f' },
      { body: 'changed' }
    ]) {
      const client = new CommunitySkillsClient(
        'https://skills.example',
        vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...metadata, body, ...altered }))
      )
      await expect(client.readVersion({ id, version: 2 })).rejects.toThrow()
    }
  })
  it('validates input before network access and refuses insecure origins', async () => {
    expect(() => new CommunitySkillsClient('http://example.com')).toThrow()
    const fetcher = vi.fn<typeof fetch>()
    const client = new CommunitySkillsClient('https://skills.example', fetcher)
    await expect(client.search({ query: 'x'.repeat(101) })).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps login tokens in the client and clears them after logout', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: 'a'.repeat(43), author: 'alice' }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
    const client = new CommunitySkillsClient('https://skills.example', fetcher)
    expect(await client.login({ username: 'alice', password: 'long password here' })).toEqual({
      configured: true,
      author: 'alice'
    })
    expect(JSON.stringify(client.status())).not.toContain('aaaa')
    await client.logout()
    expect(client.status().author).toBeNull()
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      authorization: `Bearer ${'a'.repeat(43)}`
    })
  })
  it('does not forward arbitrary error text containing private data', async () => {
    const client = new CommunitySkillsClient(
      'https://skills.example',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: 'secret credential' }, { status: 503 }))
    )
    await expect(client.search({})).rejects.toThrow('temporarily unavailable')
  })
  it('rejects oversized returned bodies', async () => {
    const client = new CommunitySkillsClient(
      'https://skills.example',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(300000)))
    )
    await expect(client.search({})).rejects.toThrow()
  })
})
