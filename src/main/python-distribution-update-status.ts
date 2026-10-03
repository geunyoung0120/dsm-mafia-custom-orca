import { existsSync } from 'node:fs'
import { join, posix, resolve, win32 } from 'node:path'
import type { UpdateStatus } from '../shared/update-status-types'
import { readRecord } from './python-update-state-file'

export function distributionManagerHome(
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv
): string {
  if (platform === 'darwin') {
    return posix.join(home, 'Library', 'Application Support', 'Orca Custom Manager')
  }
  if (platform === 'win32') {
    return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), 'OrcaCustomManager')
  }
  return posix.join(env.XDG_DATA_HOME || posix.join(home, '.local', 'share'), 'orca-custom-manager')
}

export function readDistributionUpdateStatus(
  home: string,
  platform: NodeJS.Platform
): UpdateStatus {
  const idle: UpdateStatus = { state: 'idle' }
  if (existsSync(join(home, 'paused'))) {
    return idle
  }
  const pending = readRecord(join(home, 'pending.json'))
  const status = readRecord(join(home, 'status.json'))
  if (!pending || status?.status !== 'waiting_for_quit') {
    return idle
  }
  const version = pending.version
  if (
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    status.version !== version
  ) {
    return idle
  }
  const current = pending.current
  if (
    !current ||
    typeof current !== 'object' ||
    !('repository' in current) ||
    current.repository !== 'geunyoung0120/dsm-mafia-custom-orca' ||
    !('version' in current) ||
    current.version !== version
  ) {
    return idle
  }
  if (
    typeof pending.candidate !== 'string' ||
    resolve(pending.candidate) !== resolve(home, 'prepared', version, 'payload', 'app')
  ) {
    return idle
  }
  if (
    readRecord(join(home, 'failure.json'))?.version === version ||
    readRecord(join(home, 'current.json'))?.version === version
  ) {
    return idle
  }
  const resources = platform === 'darwin' ? join('Orca.app', 'Contents', 'Resources') : 'resources'
  if (!existsSync(join(pending.candidate, resources, 'app.asar'))) {
    return idle
  }
  return { state: 'downloaded', version, externalManager: 'python' }
}
