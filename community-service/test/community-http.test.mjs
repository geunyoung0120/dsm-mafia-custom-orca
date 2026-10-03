import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../src/community-http.mjs'
import { hashPassword, verifyPassword, hashSessionToken } from '../src/password-sessions.mjs'
import { ServiceError } from '../src/skill-validation.mjs'

async function invoke(repo, path, { method = 'GET', body, token } = {}) {
  const req = {
    url: path,
    method,
    body,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  }
  let result
  const res = {
    setHeader() {},
    end(value) {
      result = { status: this.statusCode, body: JSON.parse(value) }
    }
  }
  await createHandler(
    { limit: async () => {}, cleanup: async () => {}, ...repo },
    'test-only-secret'
  )(req, res)
  return result
}
test('catalog search never loads bodies and uses bounded pagination', async () => {
  let received
  const result = await invoke(
    {
      search: async (...args) => {
        received = args
        return { items: [], hasMore: false }
      }
    },
    '/skills?query=review&offset=20'
  )
  assert.equal(result.status, 200)
  assert.deepEqual(received, ['review', 20])
  assert.equal((await invoke({}, '/skills?offset=-1')).status, 400)
})
test('publishing requires an authenticated owner', async () => {
  let published = false
  const result = await invoke(
    {
      publish: async () => {
        published = true
      }
    },
    '/skills',
    { method: 'POST', body: {} }
  )
  assert.equal(result.status, 401)
  assert.equal(published, false)
})
test('published owner identity comes from the verified session', async () => {
  let owner
  const result = await invoke(
    {
      session: async () => ({ id: 'verified-id', username: 'alice' }),
      publish: async (id) => {
        owner = id
        return { version: 1 }
      }
    },
    '/skills',
    {
      method: 'POST',
      token: 'a'.repeat(43),
      body: {
        name: 'review',
        description: '',
        body: 'Review.',
        supportedAgents: ['codex'],
        owner: 'attacker'
      }
    }
  )
  assert.equal(result.status, 200)
  assert.equal(owner, 'verified-id')
  assert.equal(result.body.author, 'alice')
})
test('version read forwards exact identity and version; hidden versions fail', async () => {
  const id = '9f048ca0-e1e3-4faf-920f-7847c2e6207f'
  let received
  const result = await invoke(
    {
      readVersion: async (...args) => {
        received = args
        throw new ServiceError(404, 'Skill version unavailable.')
      }
    },
    `/skills/${id}/versions/2`
  )
  assert.deepEqual(received, [id, 2])
  assert.equal(result.status, 404)
})
test('unexpected errors never disclose credentials or stack traces', async () => {
  const result = await invoke(
    {
      search: async () => {
        throw new Error('password=secret://connection')
      }
    },
    '/skills'
  )
  assert.equal(result.status, 503)
  assert.equal(JSON.stringify(result).includes('secret'), false)
})
test('rate limits fail before database search', async () => {
  let searched = false
  const result = await invoke(
    {
      limit: async () => {
        throw new ServiceError(429, 'Too many requests.')
      },
      search: async () => {
        searched = true
      }
    },
    '/skills'
  )
  assert.equal(result.status, 429)
  assert.equal(searched, false)
})
test('passwords are salted, sessions hashed, and wrong passwords rejected', async () => {
  const first = await hashPassword('correct long password')
  const second = await hashPassword('correct long password')
  assert.notEqual(first, second)
  assert.equal(await verifyPassword('correct long password', first), true)
  assert.equal(await verifyPassword('wrong long password', first), false)
  assert.equal(await verifyPassword('correct long password', undefined), false)
  assert.equal(hashSessionToken('token').length, 64)
})
