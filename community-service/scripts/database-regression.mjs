import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { createRepository } from '../src/community-repository.mjs'

// Explicit opt-in: creates hidden test fixtures, never edits real users or published content.
const settingsPath = process.argv[2]
const line =
  settingsPath &&
  readFileSync(settingsPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => value.trim().startsWith('DATABASE_URL='))
const url =
  process.env.DATABASE_URL ??
  line
    ?.slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
if (!url) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}
const repo = createRepository(url)
const sql = neon(url)
const fixtures = []
try {
  const user = await repo.register(
    `test_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
    'unusable-test-fixture-hash'
  )
  const publish = (name) =>
    repo.publish(user.id, {
      name,
      description: '',
      body: 'Test instructions.',
      supportedAgents: ['codex']
    })
  await sql.query('UPDATE community.quotas SET skills=99 WHERE key=$1', [`user:${user.id}`])
  const concurrent = await Promise.allSettled([publish('quota-a'), publish('quota-b')])
  for (const result of concurrent) {
    if (result.status === 'fulfilled') {
      fixtures.push(result.value.id)
    }
  }
  assert.equal(fixtures.length, 1)
  assert.equal(concurrent.find((result) => result.status === 'rejected')?.reason.status, 429)
  await sql.query('UPDATE community.quotas SET skills=1 WHERE key=$1', [`user:${user.id}`])
  const second = await publish('report-quota')
  fixtures.push(second.id)
  const originalBytes = (
    await sql.query('SELECT bytes FROM community.quotas WHERE key=$1', [`user:${user.id}`])
  )[0].bytes
  await sql.query('UPDATE community.quotas SET bytes=10485287 WHERE key=$1', [`user:${user.id}`])
  await assert.rejects(repo.report(user.id, fixtures[0], 'x'), (error) => error.status === 429)
  await sql.query('UPDATE community.quotas SET bytes=10485247 WHERE key=$1', [`user:${user.id}`])
  const reports = await Promise.allSettled(fixtures.map((id) => repo.report(user.id, id, 'x')))
  assert.equal(reports.filter((result) => result.status === 'fulfilled').length, 1)
  const reportId = fixtures[reports.findIndex((result) => result.status === 'fulfilled')]
  await assert.rejects(
    repo.report(user.id, reportId, 'x'.repeat(1000)),
    (error) => error.status === 429
  )
  const afterFailure = (
    await sql.query('SELECT bytes FROM community.quotas WHERE key=$1', [`user:${user.id}`])
  )[0].bytes
  assert.equal(Number(afterFailure), 10485760)
  await sql.query('UPDATE community.quotas SET bytes=$2 WHERE key=$1', [
    `user:${user.id}`,
    Number(originalBytes) + 513
  ])
  const tokens = Array.from({ length: 21 }, () => randomUUID().replaceAll('-', '').padEnd(64, '0'))
  for (const token of tokens) {
    await repo.createSession(user.id, token)
  }
  const sessions = await sql.query('SELECT token_hash FROM community.sessions WHERE user_id=$1', [
    user.id
  ])
  assert.equal(sessions.length, 20)
  assert.equal(Boolean(await repo.session(tokens[0])), false)
  assert.equal(Boolean(await repo.session(tokens[20])), true)
  await Promise.all(
    Array.from({ length: 21 }, () =>
      repo.createSession(user.id, randomUUID().replaceAll('-', '').padEnd(64, '0'))
    )
  )
  assert.equal(
    (
      await sql.query('SELECT count(*) AS total FROM community.sessions WHERE user_id=$1', [
        user.id
      ])
    )[0].total,
    '20'
  )
  await sql.query('DELETE FROM community.sessions WHERE user_id=$1', [user.id])
  const bucket = Math.floor(Date.now() / 60000)
  const key = `test:${randomUUID()}`
  await repo.limit(key, bucket, 2)
  await repo.limit(key, bucket + 1, 2)
  await repo.limit(key, bucket, 2)
  await assert.rejects(repo.limit(key, bucket + 1, 2), (error) => error.status === 429)
  await sql.query('DELETE FROM community.rate_limits WHERE key=$1', [key])
  await assert.rejects(
    sql.query("UPDATE community.versions SET body='changed' WHERE skill_id=$1", [fixtures[0]]),
    (error) => error.code === 'P0001'
  )
  for (const id of fixtures) {
    await repo.hide(user.id, id)
  }
  console.log(
    JSON.stringify({
      atomicPublishQuota: true,
      atomicReportQuota: true,
      reportExpansionBounded: true,
      newestLoginUsable: true,
      staleWindowCannotReset: true,
      immutableVersions: true,
      fixturesHidden: true
    })
  )
} catch (error) {
  // No errors, SQL parameters, credentials, or stack traces are printed.
  console.error(
    JSON.stringify({
      databaseRegressionPassed: false,
      errorName: error.name,
      errorCode: error.code ?? null
    })
  )
  process.exitCode = 1
} finally {
  for (const id of fixtures) {
    await sql.query('UPDATE community.skills SET visible=false WHERE id=$1', [id]).catch(() => {})
  }
}
