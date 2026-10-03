import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import {
  distributionManagerHome,
  readDistributionUpdateStatus
} from './python-distribution-update-status'
let home: string
const version = '1.0.11'
function json(name: string, value: unknown): void {
  writeFileSync(join(home, name), JSON.stringify(value))
}
function ready(platform: NodeJS.Platform): void {
  const candidate = join(home, 'prepared', version, 'payload', 'app')
  const resources =
    platform === 'darwin'
      ? join(candidate, 'Orca.app', 'Contents', 'Resources')
      : join(candidate, 'resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(join(resources, 'app.asar'), 'verified')
  json('pending.json', {
    version,
    candidate,
    current: { version, repository: 'geunyoung0120/dsm-mafia-custom-orca' }
  })
  json('status.json', { status: 'waiting_for_quit', version })
}
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'orca-manager-status-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))
it.each(['darwin', 'linux', 'win32'] as const)('shows the consumer update on %s', (platform) => {
  ready(platform)
  expect(readDistributionUpdateStatus(home, platform)).toEqual({
    state: 'downloaded',
    version,
    externalManager: 'python'
  })
})
it('resolves the Python manager path for all platforms and XDG overrides', () => {
  expect(distributionManagerHome('darwin', '/home/test', {})).toBe(
    posix.join('/home/test', 'Library/Application Support/Orca Custom Manager')
  )
  expect(distributionManagerHome('linux', '/home/test', {})).toBe(
    '/home/test/.local/share/orca-custom-manager'
  )
  expect(distributionManagerHome('linux', '/home/test', { XDG_DATA_HOME: '/data' })).toBe(
    '/data/orca-custom-manager'
  )
  expect(distributionManagerHome('win32', 'C:\\Users\\Test', { LOCALAPPDATA: 'C:\\Local' })).toBe(
    win32.join('C:\\Local', 'OrcaCustomManager')
  )
})
it('hides failed, installed, paused and missing candidates', () => {
  ready('linux')
  json('failure.json', { version })
  expect(readDistributionUpdateStatus(home, 'linux').state).toBe('idle')
  rmSync(join(home, 'failure.json'))
  json('current.json', { version })
  expect(readDistributionUpdateStatus(home, 'linux').state).toBe('idle')
  rmSync(join(home, 'current.json'))
  writeFileSync(join(home, 'paused'), '')
  expect(readDistributionUpdateStatus(home, 'linux').state).toBe('idle')
  rmSync(join(home, 'paused'))
  rmSync(join(home, 'prepared'), { recursive: true })
  expect(readDistributionUpdateStatus(home, 'linux').state).toBe('idle')
})
it('rejects mismatched versions and paths outside the prepared payload', () => {
  ready('linux')
  json('status.json', { status: 'waiting_for_quit', version: '1.0.9' })
  expect(readDistributionUpdateStatus(home, 'linux').state).toBe('idle')
  ready('linux')
  json('pending.json', {
    version,
    candidate: '/other',
    current: { version, repository: 'geunyoung0120/dsm-mafia-custom-orca' }
  })
  expect(readDistributionUpdateStatus(home, 'linux').state).toBe('idle')
})
