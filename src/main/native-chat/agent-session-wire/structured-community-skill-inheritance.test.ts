import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  appendCommunitySkillContext,
  readCommunitySkillContext
} from '../../../shared/community-skill-context'
import type { CommunitySkillVersion } from '../../../shared/community-skills'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import { testOrcaSessionId } from '../../../shared/orca-session-address-test-fixture'
import { eraseRpcMethods, type RpcContext } from '../../runtime/rpc/core'
import { ORCHESTRATION_METHODS } from '../../runtime/rpc/methods/orchestration'
import { createOrchestrationWorkerReleaseHarness } from '../../runtime/rpc/methods/orchestration/worker/worker-release.test-support'
import { setStructuredAgentSessionHost } from './structured-agent-session-registry'
import { CALLER, attachParams, hostTestState } from './structured-agent-session-host-test-harness'
import { hostTestOperationId, HOST_TEST_NOW } from './structured-agent-session-host-test-data'
import { ORCHESTRATION_WORKER_START_TASK_SPEC_MAX_BYTES } from '../../../shared/orchestration-worker-start-prompt-budget'
import { createGlobalSettingsFixture } from '../../../shared/global-settings-test-fixture'
import * as topology from '../../runtime/rpc/methods/orchestration/worker/worker-topology'
import {
  structuredWorkerIdentities,
  mintStructuredWorkerPaneKey,
  structuredWorkerProcessIncarnation
} from '../../runtime/structured-worker-identity'
import { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { configureFederationWorkerRuntime } from '../../runtime/rpc/methods/orchestration/federation/federation-runtime.test-support'

const SESSION = testOrcaSessionId('4a1f6c2e-8b3d-4e7a-9c15-0d2b6e8f1a37')
const h = createOrchestrationWorkerReleaseHarness()
const caller = {
  address: `session:${SESSION}`,
  terminalHandle: null,
  paneKey: null,
  orcaSessionId: SESSION,
  sessionId: SESSION,
  workspaceId: 'repo::worktree'
}

export function skill(
  version = 1,
  body = '# Exact cloud instructions\n한글 <content>'
): CommunitySkillVersion {
  return {
    id: '37fc3445-fd50-4862-bd75-187fe77d2c62',
    author: 'author',
    name: 'cloud-skill',
    description: 'Cloud instructions',
    version,
    body,
    digest: createHash('sha256').update(body, 'utf8').digest('hex'),
    supportedAgents: ['codex'],
    updatedAt: '2026-10-04T00:00:00Z'
  }
}

async function call(name: string, params: Record<string, unknown>, context?: Partial<RpcContext>) {
  const method = eraseRpcMethods(ORCHESTRATION_METHODS).find((entry) => entry.name === name)
  if (!method) {
    throw new Error(`Missing method ${name}`)
  }
  return method.handler(method.params?.parse(params), {
    runtime: h.runtime,
    orchestrationCaller: caller,
    ...context
  })
}

async function send(
  prompt: string,
  userSend = true,
  fingerprint?: string,
  delivery?: 'queue-if-active'
) {
  const { host, store } = hostTestState()
  const body = {
    kind: 'message' as const,
    role: 'user' as const,
    blocks: [{ type: 'text' as const, text: prompt }]
  }
  return host.send(CALLER, {
    envelope: {
      sessionId: SESSION,
      clientOperationId: hostTestOperationId(),
      expectedRuntimeFence: store.getRecord(SESSION)?.lease.runtimeFence ?? null,
      payloadFingerprint:
        fingerprint ??
        computeAgentSessionPayloadFingerprint({
          method: 'agentSession.send',
          sessionId: SESSION,
          fields: { body, ...(delivery ? { delivery } : {}) }
        })
    },
    body,
    ...(delivery ? { delivery } : {}),
    ...(userSend ? { userSend: true as const } : {})
  })
}

async function createRun() {
  return call('orchestration.runCreate', { from: caller.address, objective: 'Cloud task' })
}

async function startWorker(
  from = caller.address,
  terminal = 'term_worker',
  context?: Partial<RpcContext>
) {
  return call('orchestration.workerStart', { from, spec: 'Implement the task', terminal }, context)
}

function deliveredSkills() {
  const calls = vi.mocked(h.runtime.sendTerminalAgentPrompt).mock.calls
  const prompt = calls.at(-1)?.[1]
  expect(prompt).toContain('Implement the task')
  return readCommunitySkillContext(prompt ?? '')
}

beforeEach(async () => {
  h.setup()
  const terminal = await h.runtime.showTerminal('term_worker')
  vi.mocked(h.runtime.showTerminal).mockImplementation(async (handle) => ({
    ...terminal,
    handle,
    agentIdentity: 'codex'
  }))
  vi.spyOn(h.runtime, 'getNestedWorkerMaxDepth').mockReturnValue(4)
  const { host } = hostTestState()
  setStructuredAgentSessionHost(host)
  const base = attachParams()
  expect(
    (
      await host.attach(
        CALLER,
        attachParams({ envelope: { ...base.envelope, sessionId: SESSION } })
      )
    ).ok
  ).toBe(true)
})

afterEach(() => {
  setStructuredAgentSessionHost(null)
  structuredWorkerIdentities.clear()
  h.cleanup()
})

it.each([false, true])(
  'keeps a queued future selection out of the current turn’s first Run (current skill: %s)',
  async (hasCurrentSkill) => {
    const original = skill()
    const future = skill(2, '# Future task instructions')
    const { host, dispatch } = hostTestState()
    dispatch.mockResolvedValue({ state: 'admitted' })
    const current = await send(
      hasCurrentSkill ? appendCommunitySkillContext('Current work', [original]) : 'Current work'
    )
    expect(current.ok).toBe(true)
    await vi.waitFor(() =>
      expect(dispatch.mock.calls.some(([input]) => input.sessionId === SESSION)).toBe(true)
    )
    expect(
      await send(
        appendCommunitySkillContext('Future work', [future]),
        true,
        undefined,
        'queue-if-active'
      )
    ).toMatchObject({ ok: true, value: { queued: { state: 'waiting' } } })
    await createRun()
    await startWorker()
    expect(deliveredSkills()).toEqual(hasCurrentSkill ? [original] : [])
    if (!current.ok) {
      throw new Error('Current send was refused')
    }
    await host.settleLateDispatch({
      sessionId: SESSION,
      clientMessageId: current.value.clientMessageId,
      providerIdentity: {
        provider: 'codex',
        threadId: '019fd532-7c11-7a90-b6de-4e1a2c3d5f60',
        turnId: 'current-finished',
        ordinal: 1
      }
    })
    await vi.waitFor(() =>
      expect(dispatch.mock.calls.filter(([input]) => input.sessionId === SESSION)).toHaveLength(2)
    )
    const worker = h.db.getActiveDispatchForIdentity('term_worker', h.workerPaneKey)
    if (worker) {
      h.settle(worker.task_id, worker.id, 'succeeded')
    }
    await createRun()
    await startWorker()
    expect(deliveredSkills()).toEqual([future])
  }
)

it.each(['created', 'reused', 'unknown', 'remote'])(
  'rejects an unsupported %s worker provider before creating any Dispatch',
  async (placement) => {
    await send(appendCommunitySkillContext('Selected', [skill()]))
    await createRun()
    const created = vi.spyOn(h.db, 'createStartingWorkerDispatch')
    const terminal = await h.runtime.showTerminal('term_worker')
    vi.mocked(h.runtime.showTerminal).mockImplementation(async (handle) => ({
      ...terminal,
      handle,
      agentIdentity: placement === 'unknown' ? undefined : 'claude'
    }))
    await expect(
      call(
        'orchestration.workerStart',
        {
          from: caller.address,
          spec: 'Incompatible task',
          ...(placement === 'reused' || placement === 'unknown'
            ? { terminal: 'term_worker' }
            : { agent: 'claude' }),
          ...(placement === 'remote' ? { on: 'peer', worktree: 'folder:remote' } : {})
        },
        {
          orchestrationMutation: {
            callerFingerprint: 'client',
            requestId: 'start',
            method: 'orchestration.workerStart',
            payloadHash: 'hash'
          }
        }
      )
    ).rejects.toThrow(/Inherited community skill.*cloud-skill.*does not support worker agent/)
    expect(created).not.toHaveBeenCalled()
    expect(h.runtime.createTerminal).not.toHaveBeenCalled()
    expect(h.runtime.sendTerminalAgentPrompt).not.toHaveBeenCalled()
  }
)

it('sends exact pinned originals through the real structured host as a user-level worker turn', async () => {
  const original = skill()
  await send(appendCommunitySkillContext('Selected', [original]))
  await createRun()
  await send(appendCommunitySkillContext('Changed later', [skill(2)]))
  const { host, dispatch } = hostTestState()
  const workerId = '7e3b9d15-2c4a-4f86-a0b1-5c9e2d7f3b64'
  const base = attachParams()
  expect(
    (
      await host.attach(
        CALLER,
        attachParams({ envelope: { ...base.envelope, sessionId: workerId } })
      )
    ).ok
  ).toBe(true)
  const identity = structuredWorkerIdentities.register({
    handle: 'structworker_cloud',
    sessionId: workerId,
    agent: 'codex',
    paneKey: mintStructuredWorkerPaneKey(workerId),
    processIncarnation: structuredWorkerProcessIncarnation(workerId),
    worktreeId: 'repo::worktree',
    hostScope: { kind: 'local', hostId: 'local' }
  })
  vi.spyOn(topology, 'createStructuredWorkerSessionForWorktree').mockResolvedValue({
    host,
    identity
  })
  vi.spyOn(Date, 'now').mockReturnValue(HOST_TEST_NOW)
  vi.spyOn(h.runtime, 'getClientSettings').mockReturnValue({
    ...createGlobalSettingsFixture({
      experimentalNativeChat: true,
      experimentalStructuredNativeChat: true,
      openAgentTabsInChatByDefault: true
    }),
    hostSettingOverrides: {},
    sourceControlAi: { actions: {} }
  })
  vi.spyOn(h.runtime, 'getStructuredAgentSessionCreateSupport').mockResolvedValue({
    supported: true
  })
  vi.spyOn(h.runtime, 'getTerminalPaneKey').mockReturnValue(identity.paneKey)
  vi.spyOn(h.runtime, 'getTerminalProcessIncarnation').mockReturnValue(identity.processIncarnation)
  expect(
    await call('orchestration.workerStart', {
      from: caller.address,
      spec: 'Structured task',
      agent: 'codex'
    })
  ).toEqual(expect.objectContaining({ state: 'ready' }))
  const turn = dispatch.mock.calls.find(([input]) => input.sessionId === workerId)?.[0].body
  expect(turn?.role).toBe('user')
  expect(
    readCommunitySkillContext(
      turn?.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n') ?? ''
    )
  ).toEqual([original])
  const workerSession = testOrcaSessionId(workerId)
  const workerCaller = {
    address: identity.handle,
    terminalHandle: identity.handle,
    paneKey: identity.paneKey,
    orcaSessionId: workerSession,
    sessionId: workerSession,
    workspaceId: identity.worktreeId
  }
  await call(
    'orchestration.runCreate',
    { from: identity.handle, objective: 'Structured lead' },
    {
      orchestrationCaller: workerCaller
    }
  )
  vi.spyOn(h.runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
    handle === identity.handle ? identity.paneKey : h.workerPaneKey
  )
  expect(
    await startWorker(identity.handle, 'term_worker', { orchestrationCaller: workerCaller })
  ).toEqual(expect.objectContaining({ state: 'ready' }))
  expect(deliveredSkills()).toEqual([original])
})

it('carries pinned skills over existing federation taskSpec transport and into remote nested workers', async () => {
  const original = skill()
  await send(appendCommunitySkillContext('Selected', [original]))
  await createRun()
  await send(appendCommunitySkillContext('Changed later', [skill(2)]))
  const remoteDb = new OrchestrationDb(':memory:')
  const remote = new OrcaRuntimeService()
  remote.setOrchestrationDb(remoteDb)
  configureFederationWorkerRuntime(remote)
  vi.spyOn(remote, 'createTerminal').mockResolvedValue({
    handle: 'term_windows_worker',
    worktreeId: 'repo::windows-worktree',
    title: 'peer worker'
  })
  vi.spyOn(remote, 'showManagedTerminalWorkspace').mockResolvedValue({
    id: 'repo::windows-worktree',
    repoId: 'repo',
    path: '/tmp/peer-folder'
  })
  vi.spyOn(remote, 'getNestedWorkerMaxDepth').mockReturnValue(4)
  vi.spyOn(remote, 'getOrchestrationDispatchAuthority').mockImplementation((handle) => ({
    terminalHandle: handle,
    paneKey: remote.getTerminalPaneKey(handle)!,
    processIncarnation: 'windows_runtime:pty:1',
    runtimeId: remote.getRuntimeId(),
    ptyId: 'peer_pty',
    worktreeId: 'repo::windows-worktree',
    launchTokenHash: null,
    hostScope: { kind: 'local', hostId: 'local' }
  }))
  vi.spyOn(h.runtime, 'resolveOrchestrationWorkerServer').mockReturnValue({
    environmentId: 'peer',
    name: 'Linux',
    peerFingerprint: 'peer-key'
  })
  vi.spyOn(h.runtime, 'callOrchestrationWorkerServer').mockImplementation(
    async (_selector, method, params) => {
      if (method === 'status.get') {
        return remote.getStatus()
      }
      const entry = eraseRpcMethods(ORCHESTRATION_METHODS).find(
        (candidate) => candidate.name === method
      )
      if (!entry) {
        throw new Error(`Missing peer method ${method}`)
      }
      return entry.handler(entry.params?.parse(params), {
        runtime: remote,
        orchestrationMutation: {
          callerFingerprint: 'home',
          requestId: 'remote-start',
          method,
          payloadHash: 'hash'
        }
      })
    }
  )
  try {
    expect(
      await call(
        'orchestration.workerStart',
        {
          from: caller.address,
          spec: 'Remote task',
          agent: 'codex',
          on: 'peer',
          worktree: 'folder:remote'
        },
        {
          orchestrationMutation: {
            callerFingerprint: 'client',
            requestId: 'start',
            method: 'orchestration.workerStart',
            payloadHash: 'hash'
          }
        }
      )
    ).toEqual(expect.objectContaining({ state: 'ready' }))
    expect(
      readCommunitySkillContext(
        vi.mocked(remote.sendTerminalAgentPrompt).mock.calls.at(-1)?.[1] ?? ''
      )
    ).toEqual([original])
    await call(
      'orchestration.runCreate',
      { from: 'term_windows_worker', objective: 'Remote child' },
      { runtime: remote, orchestrationCaller: undefined }
    )
    vi.spyOn(remote, 'getTerminalPaneKey').mockImplementation((handle) =>
      handle === 'term_windows_worker'
        ? 'tab_worker:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        : 'tab_child:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    )
    vi.spyOn(remote, 'createTerminal').mockResolvedValue({
      handle: 'term_child',
      worktreeId: 'repo::windows-worktree',
      title: 'child'
    })
    expect(
      await call(
        'orchestration.workerStart',
        { from: 'term_windows_worker', spec: 'Nested peer task', agent: 'codex' },
        { runtime: remote, orchestrationCaller: undefined }
      )
    ).toEqual(expect.objectContaining({ state: 'ready' }))
    expect(
      readCommunitySkillContext(
        vi.mocked(remote.sendTerminalAgentPrompt).mock.calls.at(-1)?.[1] ?? ''
      )
    ).toEqual([original])
  } finally {
    remote.stopOrchestrationFederationRelay()
    remoteDb.close()
  }
})

it('pins the accepted coordinator context at Run creation, before later user selections', async () => {
  const original = skill()
  expect((await send(appendCommunitySkillContext('Use this skill', [original]))).ok).toBe(true)
  await createRun()
  expect(
    (await send(appendCommunitySkillContext('Now use another version', [skill(2, '# Changed')]))).ok
  ).toBe(true)
  await startWorker()
  expect(deliveredSkills()).toEqual([original])
})

it('inherits the pinned Dispatch into a worker-created Run and its nested worker', async () => {
  const original = skill()
  await send(appendCommunitySkillContext('Use original', [original]))
  await createRun()
  await startWorker()
  await send(appendCommunitySkillContext('Coordinator changed', [skill(2, '# Different')]))
  await call(
    'orchestration.runCreate',
    { from: 'term_worker', objective: 'Nested task' },
    { orchestrationCaller: undefined }
  )
  vi.spyOn(h.runtime, 'getTerminalPaneKey').mockImplementation((handle) =>
    handle === 'term_worker' ? h.workerPaneKey : 'tab_nested:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  )
  vi.spyOn(h.runtime, 'getTerminalProcessIncarnation').mockReturnValue('runtime_test:nested:1')
  vi.spyOn(h.runtime, 'getOrchestrationDispatchAuthority').mockImplementation((handle) => ({
    terminalHandle: handle,
    paneKey: h.runtime.getTerminalPaneKey(handle)!,
    runtimeId: h.runtime.getRuntimeId(),
    ptyId: 'pty_test',
    worktreeId: 'repo::worktree',
    launchTokenHash: null,
    processIncarnation: 'runtime_test:nested:1',
    hostScope: { kind: 'local', hostId: 'local' }
  }))
  await startWorker('term_worker', 'term_nested', { orchestrationCaller: undefined })
  expect(deliveredSkills()).toEqual([original])
})

it('does not register a refused send or a host-internal message as a user selection', async () => {
  const original = skill()
  await send(appendCommunitySkillContext('Use original', [original]))
  expect(
    (await send(appendCommunitySkillContext('Refused', [skill(2)]), true, '0'.repeat(64))).ok
  ).toBe(false)
  await send(appendCommunitySkillContext('Host mail', [skill(3)]), false)
  await createRun()
  await startWorker()
  expect(deliveredSkills()).toEqual([original])
})

it('rejects a forged SHA256 digest before accepting the context', async () => {
  const forged = { ...skill(), digest: '0'.repeat(64) }
  const result = await send(appendCommunitySkillContext('Forged', [forged]))
  expect(result.ok).toBe(false)
  await createRun()
  await startWorker()
  expect(deliveredSkills()).toEqual([])
})

it('isolates future Runs and cleans a closed coordinator context without changing pinned originals', async () => {
  const original = skill()
  await send(appendCommunitySkillContext('Use original', [original]))
  await createRun()
  await hostTestState().host.close(SESSION)
  await startWorker()
  expect(deliveredSkills()).toEqual([original])
  const worker = h.db.getActiveDispatchForIdentity('term_worker', h.workerPaneKey)
  expect(worker).not.toBeNull()
  if (worker) {
    h.settle(worker.task_id, worker.id, 'succeeded')
  }
  await createRun()
  expect(await startWorker(caller.address, 'term_reminted')).toEqual(
    expect.objectContaining({ state: 'ready' })
  )
  expect(deliveredSkills()).toEqual([])
})

it('counts inherited skill bytes in worker-start preflight before creating a Dispatch', async () => {
  await send(appendCommunitySkillContext('Large skill', [skill(1, 'x'.repeat(64 * 1024))]))
  await createRun()
  const createDispatch = vi.spyOn(h.db, 'createStartingWorkerDispatch')
  await expect(
    call('orchestration.workerStart', {
      from: caller.address,
      terminal: 'term_worker',
      spec: 'x'.repeat(ORCHESTRATION_WORKER_START_TASK_SPEC_MAX_BYTES)
    })
  ).rejects.toMatchObject({ code: 'worker_prompt_too_large' })
  expect(createDispatch).not.toHaveBeenCalled()
})
