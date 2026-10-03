import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPythonUpdateStatus } from './python-update-status'

let home: string
const hash = 'a'.repeat(64)
function json(name: string, value: unknown): void {
  writeFileSync(join(home, name), JSON.stringify(value))
}
function ready(): void {
  const job = join(home, 'jobs', 'fixture')
  const candidate = join(job, 'candidate', 'Orca.app')
  mkdirSync(join(candidate, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(join(candidate, 'Contents', 'Resources', 'app.asar'), 'verified fixture')
  json('pending.json', { version: '1.4.218', candidate, job, candidateHash: hash, patchHash: hash })
  json('state.json', { status: 'waiting_for_quit', version: '1.4.218', job })
}
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orca-update-status-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('Python updater readiness', () => {
  it('stays idle with no pending update', () => {
    expect(readPythonUpdateStatus(home)).toEqual({ state: 'idle' })
  })
  it('reports a validated update awaiting quit', () => {
    ready()
    expect(readPythonUpdateStatus(home)).toEqual({
      state: 'downloaded',
      version: '1.4.218',
      externalManager: 'python'
    })
  })
  it('does not report a candidate still being prepared or failed', () => {
    ready()
    for (const status of ['preparing', 'failed', 'blocked_after_failure']) {
      json('state.json', { status, version: '1.4.218' })
      expect(readPythonUpdateStatus(home)).toEqual({ state: 'idle' })
    }
  })
  it('hides stale readiness after installation and pause', () => {
    ready()
    json('last-install.json', { candidateHash: hash })
    expect(readPythonUpdateStatus(home)).toEqual({ state: 'idle' })
    rmSync(join(home, 'last-install.json'))
    writeFileSync(join(home, 'paused'), '')
    expect(readPythonUpdateStatus(home)).toEqual({ state: 'idle' })
  })
  it('fails closed for corrupt state, missing candidate, and mismatched jobs', () => {
    ready()
    writeFileSync(join(home, 'pending.json'), '{invalid')
    expect(readPythonUpdateStatus(home)).toEqual({ state: 'idle' })
    ready()
    json('state.json', { status: 'waiting_for_quit', version: '1.4.218', job: '/different' })
    expect(readPythonUpdateStatus(home)).toEqual({ state: 'idle' })
    ready()
    rmSync(join(home, 'jobs'), { recursive: true })
    expect(readPythonUpdateStatus(home)).toEqual({ state: 'idle' })
  })
})
