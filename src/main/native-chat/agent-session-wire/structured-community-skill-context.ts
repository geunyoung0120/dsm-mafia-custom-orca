import { createHash } from 'node:crypto'
import {
  appendCommunitySkillContext,
  readCommunitySkillContext
} from '../../../shared/community-skill-context'
import { COMMUNITY_SKILL_BODY_MAX_BYTES } from '../../../shared/community-skills'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'

const contexts = new WeakMap<object, Map<string, string>>()
const queuedContexts = new WeakMap<object, Map<string, Map<string, string>>>()
const START = '<<<ORCA_COMMUNITY_SKILLS_V1>>>'

export function validatedCommunitySkillContext(prompt: string): string {
  const skills = readCommunitySkillContext(prompt)
  if (skills.length === 0) {
    return ''
  }
  // Multiple envelopes could make the model and the runtime select different versions.
  if (prompt.includes(START, prompt.indexOf(START) + START.length)) {
    throw new Error('Multiple community skill contexts are not supported.')
  }
  for (const skill of skills) {
    if (Buffer.byteLength(skill.body, 'utf8') > COMMUNITY_SKILL_BODY_MAX_BYTES) {
      throw new Error('Community skill body is too large.')
    }
    if (createHash('sha256').update(skill.body, 'utf8').digest('hex') !== skill.digest) {
      throw new Error('Community skill digest does not match its body.')
    }
  }
  return appendCommunitySkillContext('', skills)
}

export function communitySkillContextFromUserBody(body: AgentJournalMessageItem): string {
  if (body.role !== 'user') {
    return ''
  }
  return validatedCommunitySkillContext(
    body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
  )
}

export function captureStructuredCommunitySkillContext(
  store: object,
  sessionId: string,
  context: string
): void {
  const sessions = contexts.get(store) ?? new Map<string, string>()
  sessions.set(sessionId, validatedCommunitySkillContext(context))
  contexts.set(store, sessions)
}

export function readStructuredCommunitySkillContext(store: object, sessionId: string): string {
  return contexts.get(store)?.get(sessionId) ?? ''
}

export function stageQueuedCommunitySkillContext(
  store: object,
  sessionId: string,
  messageId: string,
  context: string,
  liveMessageIds: ReadonlySet<string>
): void {
  const sessions = queuedContexts.get(store) ?? new Map<string, Map<string, string>>()
  const queued = sessions.get(sessionId) ?? new Map<string, string>()
  // Deleted drafts cannot accumulate bodies during a long-lived conversation.
  for (const id of queued.keys()) {
    if (!liveMessageIds.has(id)) {
      queued.delete(id)
    }
  }
  queued.set(messageId, validatedCommunitySkillContext(context))
  sessions.set(sessionId, queued)
  queuedContexts.set(store, sessions)
}

/** Runs at the provider's existing write boundary, not at draft admission. */
export function prepareQueuedCommunitySkillContextActivation(
  store: object,
  sessionId: string,
  messageId: string | null | undefined
): (() => (() => void) | undefined) | undefined {
  if (!messageId || !queuedContexts.get(store)?.get(sessionId)?.has(messageId)) {
    return undefined
  }
  return () => activateQueuedCommunitySkillContext(store, sessionId, messageId)
}

export function activateQueuedCommunitySkillContext(
  store: object,
  sessionId: string,
  messageId: string | null | undefined
): (() => void) | undefined {
  if (!messageId) {
    return undefined
  }
  const queued = queuedContexts.get(store)?.get(sessionId)
  const context = queued?.get(messageId)
  if (context === undefined) {
    return undefined
  }
  const previous = readStructuredCommunitySkillContext(store, sessionId)
  captureStructuredCommunitySkillContext(store, sessionId, context)
  queued?.delete(messageId)
  // A definitive refusal proves this turn never ran. Unknown delivery retains the selection.
  return () => {
    captureStructuredCommunitySkillContext(store, sessionId, previous)
    queued?.set(messageId, context)
  }
}

export function forgetStructuredCommunitySkillContext(store: object, sessionId: string): void {
  contexts.get(store)?.delete(sessionId)
  queuedContexts.get(store)?.delete(sessionId)
}

export function clearStructuredCommunitySkillContexts(store: object): void {
  contexts.delete(store)
  queuedContexts.delete(store)
}
