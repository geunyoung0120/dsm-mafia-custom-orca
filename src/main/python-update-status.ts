import { readRecord } from './python-update-state-file'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import {
  distributionManagerHome,
  readDistributionUpdateStatus
} from './python-distribution-update-status'
import { isAbsolute, join, relative } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { UpdateStatus } from '../shared/update-status-types'

export function readPythonUpdateStatus(home: string): UpdateStatus {
  const idle: UpdateStatus = { state: 'idle' }
  if (existsSync(join(home, 'paused'))) {
    return idle
  }
  const pending = readRecord(join(home, 'pending.json'))
  const status = readRecord(join(home, 'state.json'))
  if (!pending || !status || status.status !== 'waiting_for_quit') {
    return idle
  }
  if (
    typeof pending.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(pending.version) ||
    typeof pending.job !== 'string' ||
    typeof pending.candidate !== 'string' ||
    typeof pending.candidateHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(pending.candidateHash) ||
    status.job !== pending.job ||
    status.version !== pending.version
  ) {
    return idle
  }
  const jobPath = relative(join(home, 'jobs'), pending.job)
  const candidatePath = relative(pending.job, pending.candidate)
  if (
    !jobPath ||
    jobPath.startsWith('..') ||
    isAbsolute(jobPath) ||
    !candidatePath ||
    candidatePath.startsWith('..') ||
    isAbsolute(candidatePath)
  ) {
    return idle
  }
  if (!existsSync(join(pending.candidate, 'Contents', 'Resources', 'app.asar'))) {
    return idle
  }
  const installed = readRecord(join(home, 'last-install.json'))
  if (installed?.candidateHash === pending.candidateHash) {
    return idle
  }
  return { state: 'downloaded', version: pending.version, externalManager: 'python' }
}

export function getPythonUpdateStatus(): UpdateStatus {
  if (process.type !== 'browser') {
    return { state: 'idle' }
  }
  return readDistributionUpdateStatus(
    distributionManagerHome(process.platform, homedir(), process.env),
    process.platform
  )
}

export function observePythonUpdateStatus(window: BrowserWindow): void {
  let previous = ''
  const publish = (): void => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      return
    }
    const status = getPythonUpdateStatus()
    const serialized = JSON.stringify(status)
    if (serialized !== previous) {
      previous = serialized
      window.webContents.send('updater:status', status)
    }
  }
  publish()
  const timer = setInterval(publish, 5000)
  timer.unref()
  window.once('closed', () => clearInterval(timer))
}
