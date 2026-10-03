import { createRootDispatch } from './orchestration/db/root-dispatch-test-fixture'
import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeAgentOrchestrationProjection } from './runtime-agent-orchestration-projection'
import {
  structuredWorkerIdentities,
  type StructuredWorkerIdentity
} from './structured-worker-identity'
import { OrchestrationDb } from './orchestration/db'
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../shared/structured-agent-session-projection'

const coordinator: StructuredWorkerIdentity = {
  handle: 'term_structured_coord',
  sessionId: 'coord-session',
  agent: 'codex',
  paneKey: 'agent-session:coord-session:11111111-1111-4111-a111-111111111111',
  processIncarnation: 'structured:coord-session',
  worktreeId: 'folder:/workspace',
  hostScope: { kind: 'local', hostId: 'local' }
}
const worker: StructuredWorkerIdentity = {
  ...coordinator,
  handle: 'term_structured_worker',
  sessionId: 'worker-session',
  paneKey: 'agent-session:worker-session:22222222-2222-4222-a222-222222222222'
}
const displayPane = (identity: StructuredWorkerIdentity): string =>
  structuredAgentSessionPaneKey(structuredAgentSessionTabId(identity.sessionId), identity.sessionId)
afterEach(() => {
  structuredWorkerIdentities.forget(coordinator.handle)
  structuredWorkerIdentities.forget(worker.handle)
  vi.restoreAllMocks()
})
it('projects Codex native workers under the requesting chat without PTYs or authority-key changes', () => {
  structuredWorkerIdentities.register(coordinator)
  structuredWorkerIdentities.register(worker)
  const db = new OrchestrationDb(':memory:')
  const run = db.createRun({
    objective: 'Check Linux',
    coordinatorHandle: coordinator.handle,
    coordinatorPaneKey: coordinator.paneKey
  })
  const task = db.createTask({
    spec: 'Check Linux',
    runId: run.id,
    createdByTerminalHandle: coordinator.handle,
    createdByPaneKey: coordinator.paneKey
  })
  const dispatch = createRootDispatch(db, task.id, worker.handle, worker.paneKey)
  const projection = new RuntimeAgentOrchestrationProjection({
    getDb: () => db,
    getLeaves: () => [],
    getPtys: () => [],
    issueLeafHandle: () => '',
    issuePtyHandle: () => '',
    makePaneKey: () => '',
    getWorktreeId: () => null,
    getHandleForPaneKey: () => null,
    getPaneKey: () => null,
    getDispatchAuthority: () => null,
    getAgentStatusSnapshot: () => []
  })
  const contexts = projection.buildByPaneKey() ?? {}
  expect(contexts[displayPane(worker)]).toMatchObject({
    dispatchId: dispatch.id,
    parentPaneKey: displayPane(coordinator)
  })
  expect(structuredWorkerIdentities.get(worker.handle)?.paneKey).toBe(worker.paneKey)
  structuredWorkerIdentities.forget(worker.handle)
  expect(projection.buildByPaneKey()).toBeUndefined()
  db.close()
})
