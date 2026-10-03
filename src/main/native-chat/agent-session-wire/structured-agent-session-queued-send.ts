// A send's queue step around its immediate path: the queue decision before it. A
// person's send lifts a paused queue through its recorded origin once its turn
// starts (`structured-agent-session-queued-pause.ts`), not through anything here.

import type { AgentSessionSendResult } from '../../../shared/agent-session-wire'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import type { StructuredAgentSessionMutationContext } from './structured-agent-session-host-mutations'
import { maybeQueueStructuredAgentSessionSend } from './structured-agent-session-queued-messages'
import type { AgentSessionTurnContext, TurnOutcome } from './structured-agent-session-turns'
import { refuse } from '../../../shared/agent-session-wire'
import {
  captureStructuredCommunitySkillContext,
  communitySkillContextFromUserBody,
  stageQueuedCommunitySkillContext
} from './structured-community-skill-context'

export async function runQueueableStructuredAgentSessionSend(
  context: StructuredAgentSessionMutationContext,
  ctx: AgentSessionTurnContext,
  params: {
    envelope: { clientOperationId: string }
    body: AgentJournalMessageItem
    delivery?: 'queue-if-active'
    userSend?: true
  },
  immediate: () => Promise<TurnOutcome<AgentSessionSendResult>>
): Promise<TurnOutcome<AgentSessionSendResult>> {
  let skillContext: string | undefined
  if (params.userSend) {
    try {
      skillContext = communitySkillContextFromUserBody(params.body)
    } catch (error) {
      return {
        ok: false,
        refusal: refuse(
          'agent_session_operation_invalid',
          { reason: 'requestMalformed' },
          error instanceof Error ? error.message : 'Invalid community skill context.'
        )
      }
    }
  }
  // The queue decision runs first: a capable send while the session owes work (a
  // /compact included — it is a queued message like any other) becomes a draft;
  // only a `blocked` hold, which never queues, falls through to the refusal.
  const queued = await maybeQueueStructuredAgentSessionSend(context, ctx, params)
  if (queued) {
    if (
      queued.ok &&
      'queued' in queued.value &&
      (queued.value.queued.state === 'waiting' || queued.value.queued.state === 'returned') &&
      skillContext !== undefined
    ) {
      stageQueuedCommunitySkillContext(
        context.deps.store,
        ctx.sessionId,
        queued.value.queued.messageId,
        skillContext,
        new Set(
          ctx.journal.queuedMessages
            .list()
            .filter((row) => row.state !== 'withdrawn')
            .map((row) => row.messageId)
        )
      )
    }
    return queued
  }
  const accepted = await immediate()
  if (accepted.ok) {
    if (skillContext !== undefined) {
      captureStructuredCommunitySkillContext(context.deps.store, ctx.sessionId, skillContext)
    }
    context.wakeDelivery(ctx.sessionId)
  }
  return accepted
}
