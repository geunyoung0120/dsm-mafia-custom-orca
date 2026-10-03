import { z } from 'zod'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  readStructuredCommunitySkillContext,
  validatedCommunitySkillContext
} from '../../native-chat/agent-session-wire/structured-community-skill-context'
import type { OrchestrationDb } from './db'
import type { OrchestrationCallerIdentity } from './orchestration-caller-identity'
import type { RunRow } from './types'
import type { DispatchCreator } from './db/dispatch-depth'
import { readCommunitySkillContext } from '../../../shared/community-skill-context'
import { OrchestrationError } from './orchestration-error'
import type { OrcaRuntimeService } from '../orca-runtime'

const runContexts = new WeakMap<object, Map<string, string>>()
const attachmentContexts = new WeakMap<object, Map<string, string>>()
const startOptionsSchema = z.object({ communitySkillContext: z.string().optional() })

export function inheritCommunitySkillsInPrompt(context: string, prompt: string): string {
  return context ? `${context}\n\n${prompt}` : prompt
}

export function assertCommunitySkillWorkerCompatibility(
  prompt: string,
  agent: string | undefined
): void {
  const skills = readCommunitySkillContext(validatedCommunitySkillContext(prompt))
  const incompatible = skills.find(
    (skill) => !agent || !skill.supportedAgents.some((supported) => supported === agent)
  )
  if (incompatible) {
    throw new OrchestrationError(
      'invalid_argument',
      `Inherited community skill ${incompatible.name}@${incompatible.version} does not support worker agent ${agent ?? 'unknown'}. Choose a supported worker provider before starting the Dispatch.`
    )
  }
}

export async function assertCommunitySkillsOnWorker(
  prompt: string,
  runtime: OrcaRuntimeService,
  params: { agent?: string; terminal?: string }
): Promise<void> {
  const context = validatedCommunitySkillContext(prompt)
  if (context) {
    const agent =
      params.agent ??
      (params.terminal ? (await runtime.showTerminal(params.terminal)).agentIdentity : undefined)
    assertCommunitySkillWorkerCompatibility(context, agent)
  }
}

export async function assertCommunitySkillsOnRemoteWorker(
  context: string,
  runtime: OrcaRuntimeService,
  params: { terminal?: string },
  server: ReturnType<OrcaRuntimeService['resolveOrchestrationWorkerServer']>,
  timeoutMs: number
): Promise<void> {
  if (context && params.terminal) {
    const shown = z
      .object({ terminal: z.object({ agentIdentity: z.string().optional() }) })
      .parse(
        await runtime.callOrchestrationWorkerServer(
          server.environmentId,
          'terminal.show',
          { terminal: params.terminal },
          timeoutMs,
          undefined,
          { expectedEnvironmentPairingRevision: server.pairingRevision }
        )
      )
    assertCommunitySkillWorkerCompatibility(context, shown.terminal.agentIdentity)
  }
}

export function dispatchCommunitySkillContext(
  db: OrchestrationDb,
  dispatchId: string
): string | undefined {
  const worker = db.getWorkerDispatch(dispatchId)
  if (!worker) {
    return attachmentContexts.get(db)?.get(dispatchId)
  }
  const context = startOptionsSchema.parse(JSON.parse(worker.start_options)).communitySkillContext
  return context === undefined ? undefined : validatedCommunitySkillContext(context)
}

export function pinRunCommunitySkillContext(
  db: OrchestrationDb,
  run: RunRow,
  caller: OrchestrationCallerIdentity | null,
  creator?: DispatchCreator
): string {
  const runs = runContexts.get(db) ?? new Map<string, string>()
  const pinned = runs.get(run.id)
  if (pinned !== undefined) {
    return pinned
  }
  const parentId = creator
    ? db.resolveCreatorDispatchId(creator)
    : caller
      ? db.getActiveDispatchForIdentity(caller.address, caller.paneKey ?? undefined)?.id
      : undefined
  const inherited = parentId ? dispatchCommunitySkillContext(db, parentId) : undefined
  const host = getStructuredAgentSessionHost()
  const selected =
    caller?.orcaSessionId && host
      ? readStructuredCommunitySkillContext(host.deps.store, caller.orcaSessionId)
      : ''
  const context = inherited ?? selected
  runs.set(run.id, context)
  runContexts.set(db, runs)
  return context
}

export function pinAttachmentCommunitySkillContext(
  db: OrchestrationDb,
  dispatchId: string,
  prompt: string
): string {
  const attachments = attachmentContexts.get(db) ?? new Map<string, string>()
  const pinned = attachments.get(dispatchId)
  if (pinned !== undefined) {
    return pinned
  }
  const context = validatedCommunitySkillContext(prompt)
  attachments.set(dispatchId, context)
  attachmentContexts.set(db, attachments)
  return context
}

export function clearAttachmentCommunitySkillContexts(db: object): void {
  attachmentContexts.delete(db)
}

export function clearRunCommunitySkillContexts(db: object): void {
  runContexts.delete(db)
}
