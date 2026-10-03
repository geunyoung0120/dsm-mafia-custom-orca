import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validatePublish,
  validateCredentials,
  digestBody,
  parseSkillRoute
} from '../src/skill-validation.mjs'

const good = {
  name: 'review',
  description: 'Review changes',
  body: '# Review\nInspect correctness.',
  supportedAgents: ['codex']
}
test('publishing accepts Markdown instructions and hashes exact UTF-8 bytes', () => {
  assert.deepEqual(validatePublish(good), good)
  assert.equal(
    digestBody('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
})
test('UTF-8 byte size and supported provider are bounded', () => {
  assert.throws(() => validatePublish({ ...good, body: '한'.repeat(23000) }))
  assert.throws(() => validatePublish({ ...good, supportedAgents: ['unsupported'] }))
  assert.throws(() => validatePublish({ ...good, name: '../bad' }))
})
test('declared companion files cannot be published as instruction-only skills', () => {
  assert.throws(() =>
    validatePublish({ ...good, body: '---\nname: test\ndependencies: scripts/run.py\n---\nGo' })
  )
  assert.throws(() => validatePublish({ ...good, body: 'Read [rules](references/rules.md)' }))
  assert.doesNotThrow(() =>
    validatePublish({ ...good, body: 'Read [docs](https://example.com/docs)' })
  )
})
test('accounts require bounded lowercase handles and long passwords', () => {
  assert.doesNotThrow(() => validateCredentials({ username: 'alice', password: 'a long password' }))
  assert.throws(() => validateCredentials({ username: 'Admin', password: 'a long password' }))
  assert.throws(() => validateCredentials({ username: 'alice', password: 'short' }))
})
test('version route binds UUID and integer version, never names or SQL fragments', () => {
  assert.deepEqual(parseSkillRoute('/skills/9f048ca0-e1e3-4faf-920f-7847c2e6207f/versions/3'), {
    id: '9f048ca0-e1e3-4faf-920f-7847c2e6207f',
    version: 3
  })
  assert.equal(parseSkillRoute('/skills/test/versions/3'), null)
  assert.equal(parseSkillRoute('/skills/9f048ca0-e1e3-4faf-920f-7847c2e6207f/versions/0'), null)
})
