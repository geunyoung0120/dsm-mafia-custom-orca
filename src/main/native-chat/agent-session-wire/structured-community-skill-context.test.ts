import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import {
  appendCommunitySkillContext,
  readCommunitySkillContext
} from '../../../shared/community-skill-context'
import type { CommunitySkillVersion } from '../../../shared/community-skills'
import {
  validatedCommunitySkillContext,
  captureStructuredCommunitySkillContext,
  readStructuredCommunitySkillContext,
  forgetStructuredCommunitySkillContext,
  clearStructuredCommunitySkillContexts,
  communitySkillContextFromUserBody,
  stageQueuedCommunitySkillContext,
  activateQueuedCommunitySkillContext,
  prepareQueuedCommunitySkillContextActivation
} from './structured-community-skill-context'

function skill(body = '# Apply instructions'): CommunitySkillVersion {
  return {
    id: '37fc3445-fd50-4862-bd75-187fe77d2c62',
    author: 'author',
    name: 'cloud-skill',
    description: '',
    version: 1,
    body,
    digest: createHash('sha256').update(body).digest('hex'),
    supportedAgents: ['codex'],
    updatedAt: '2026-10-04T00:00:00Z'
  }
}

function envelope(skills: CommunitySkillVersion[]): string {
  return `<<<ORCA_COMMUNITY_SKILLS_V1>>>\n${JSON.stringify(skills).replaceAll('<', '\\u003c')}\n<<<END_ORCA_COMMUNITY_SKILLS_V1>>>`
}

it('preserves exact metadata, order, CRLF, Unicode and marker-like Markdown in skill bodies', () => {
  const skills = [
    skill('# 한글\r\n  exact <body>\n<<<ORCA_COMMUNITY_SKILLS_V1>>>'),
    { ...skill(), version: 3 }
  ]
  expect(readCommunitySkillContext(validatedCommunitySkillContext(envelope(skills)))).toEqual(
    skills
  )
})

it.each([
  ['nine versions', () => envelope(Array.from({ length: 9 }, () => skill()))],
  [
    'over 128 KiB total',
    () => envelope(Array.from({ length: 3 }, () => skill('a'.repeat(44 * 1024))))
  ],
  ['over 64 KiB UTF8 body', () => envelope([skill('한'.repeat(22 * 1024))])],
  ['forged digest', () => envelope([{ ...skill(), digest: '0'.repeat(64) }])],
  ['empty versions', () => envelope([])],
  ['malformed JSON', () => '<<<ORCA_COMMUNITY_SKILLS_V1>>>oops<<<END_ORCA_COMMUNITY_SKILLS_V1>>>'],
  ['unterminated envelope', () => '<<<ORCA_COMMUNITY_SKILLS_V1>>>[]'],
  ['multiple envelopes', () => `${envelope([skill()])}\n${envelope([skill()])}`]
])('refuses %s before registry acceptance', (_name, prompt) => {
  const store = {}
  const original = validatedCommunitySkillContext(envelope([skill()]))
  captureStructuredCommunitySkillContext(store, 'session', original)
  expect(() => captureStructuredCommunitySkillContext(store, 'session', prompt())).toThrow()
  expect(readStructuredCommunitySkillContext(store, 'session')).toBe(original)
})

it('accepts eight versions and exactly 128 KiB total', () => {
  const skills = Array.from({ length: 8 }, () => skill('a'.repeat(16 * 1024)))
  expect(readCommunitySkillContext(validatedCommunitySkillContext(envelope(skills)))).toEqual(
    skills
  )
})

it('keeps store and session contexts isolated and cleans individual or all contexts', () => {
  const a = {},
    b = {}
  const original = validatedCommunitySkillContext(envelope([skill()]))
  captureStructuredCommunitySkillContext(a, 'same-id', original)
  captureStructuredCommunitySkillContext(a, 'other', original)
  expect(readStructuredCommunitySkillContext(b, 'same-id')).toBe('')
  forgetStructuredCommunitySkillContext(a, 'same-id')
  expect(readStructuredCommunitySkillContext(a, 'same-id')).toBe('')
  expect(readStructuredCommunitySkillContext(a, 'other')).toBe(original)
  clearStructuredCommunitySkillContexts(a)
  expect(readStructuredCommunitySkillContext(a, 'other')).toBe('')
})

it('does not expose mutable caller objects or returned versions through its registry', () => {
  const store = {},
    original = skill()
  captureStructuredCommunitySkillContext(
    store,
    'session',
    appendCommunitySkillContext('', [original])
  )
  original.body = 'mutated caller'
  const read = readCommunitySkillContext(readStructuredCommunitySkillContext(store, 'session'))
  read[0]!.body = 'mutated reader'
  expect(
    readCommunitySkillContext(readStructuredCommunitySkillContext(store, 'session'))[0]?.body
  ).toBe('# Apply instructions')
})

it('activates only the matching queued user selection and can roll back a definitive rejection', () => {
  const store = {}
  const original = appendCommunitySkillContext('', [skill()])
  const future = appendCommunitySkillContext('', [skill('# Future')])
  captureStructuredCommunitySkillContext(store, 'session', original)
  expect(prepareQueuedCommunitySkillContextActivation(store, 'session', undefined)).toBeUndefined()
  expect(
    prepareQueuedCommunitySkillContextActivation(store, 'session', 'host-message')
  ).toBeUndefined()
  stageQueuedCommunitySkillContext(store, 'session', 'draft', future, new Set(['draft']))
  expect(prepareQueuedCommunitySkillContextActivation(store, 'session', 'draft')).toBeTypeOf(
    'function'
  )
  expect(readStructuredCommunitySkillContext(store, 'session')).toBe(original)
  expect(activateQueuedCommunitySkillContext(store, 'other', 'draft')).toBeUndefined()
  expect(activateQueuedCommunitySkillContext({}, 'session', 'draft')).toBeUndefined()
  expect(activateQueuedCommunitySkillContext(store, 'session', 'host-message')).toBeUndefined()
  const rollback = activateQueuedCommunitySkillContext(store, 'session', 'draft')
  expect(readStructuredCommunitySkillContext(store, 'session')).toBe(future)
  expect(activateQueuedCommunitySkillContext(store, 'session', 'draft')).toBeUndefined()
  rollback?.()
  expect(readStructuredCommunitySkillContext(store, 'session')).toBe(original)
  activateQueuedCommunitySkillContext(store, 'session', 'draft')
  expect(readStructuredCommunitySkillContext(store, 'session')).toBe(future)
})

it('defers an empty queued selection and removes deleted or closed draft contexts', () => {
  const store = {}
  const original = appendCommunitySkillContext('', [skill()])
  captureStructuredCommunitySkillContext(store, 'session', original)
  stageQueuedCommunitySkillContext(store, 'session', 'deleted', original, new Set(['deleted']))
  stageQueuedCommunitySkillContext(store, 'session', 'plain', '', new Set(['plain']))
  expect(activateQueuedCommunitySkillContext(store, 'session', 'deleted')).toBeUndefined()
  expect(readStructuredCommunitySkillContext(store, 'session')).toBe(original)
  activateQueuedCommunitySkillContext(store, 'session', 'plain')
  expect(readStructuredCommunitySkillContext(store, 'session')).toBe('')
  stageQueuedCommunitySkillContext(store, 'session', 'close', original, new Set(['close']))
  forgetStructuredCommunitySkillContext(store, 'session')
  expect(activateQueuedCommunitySkillContext(store, 'session', 'close')).toBeUndefined()
  stageQueuedCommunitySkillContext(store, 'session', 'quit', original, new Set(['quit']))
  clearStructuredCommunitySkillContexts(store)
  expect(activateQueuedCommunitySkillContext(store, 'session', 'quit')).toBeUndefined()
})

it('rejects an envelope split inside a JSON string and ignores assistant text', () => {
  const serialized = envelope([skill()])
  const middle = serialized.indexOf('Apply') + 2
  const body = {
    kind: 'message' as const,
    role: 'user' as const,
    blocks: [
      { type: 'text' as const, text: serialized.slice(0, middle) },
      { type: 'text' as const, text: serialized.slice(middle) }
    ]
  }
  // Text block boundaries are distinct text: splitting inside a JSON token must fail closed.
  expect(() => communitySkillContextFromUserBody(body)).toThrow()
  expect(communitySkillContextFromUserBody({ ...body, role: 'assistant' })).toBe('')
})
