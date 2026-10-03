import type { BrowserWindow } from 'electron'
import type {
  LinuxPackageInstallInstructions,
  UpdateCheckOptions,
  UpdateStatus
} from '../shared/update-status-types'
import type {
  RemoteServerUpdateInstallResult,
  RemoteServerUpdaterSnapshot,
  RemoteServerUpdateSupport
} from '../shared/remote-server-update'
import type { ReleaseBuild, ReleaseChannel } from '../shared/release-channel'
import type { ReleaseBuildListOptions } from './updater-release-build-cache'
import { UpdaterSetup, type UpdaterSetupOptions } from './updater/updater-setup'
import type { PreQuitCleanupFailureMode, UpdateInstallMode } from './updater/updater-state'

// Keep one service instance so all public API calls share updater state and event listeners.
const updater = new UpdaterSetup()

export type { PreQuitCleanupFailureMode, UpdateInstallMode, UpdaterSetupOptions }

export function resolveUpdateInstallMode(isServeMode: boolean): UpdateInstallMode {
  return updater.resolveUpdateInstallMode(isServeMode)
}

export function getUpdateStatus(): UpdateStatus {
  return { state: 'idle' }
}

export function getRemoteServerUpdateSupport(): RemoteServerUpdateSupport {
  return updater.getRemoteServerUpdateSupport()
}

export function getRemoteServerUpdaterSnapshot(runtimeId: string): RemoteServerUpdaterSnapshot {
  return updater.getRemoteServerUpdaterSnapshot(runtimeId)
}

export function checkForRemoteServerUpdate(
  runtimeId: string,
  options?: UpdateCheckOptions
): RemoteServerUpdaterSnapshot {
  return updater.checkForRemoteServerUpdate(runtimeId, options)
}

export function downloadRemoteServerUpdate(runtimeId: string): RemoteServerUpdaterSnapshot {
  return updater.downloadRemoteServerUpdate(runtimeId)
}

export function installRemoteServerUpdate(runtimeId: string): RemoteServerUpdateInstallResult {
  return updater.installRemoteServerUpdate(runtimeId)
}

export function checkForUpdates(): void {
  // The separately scheduled Python updater owns desktop updates in this distribution.
}

export function checkForUpdatesFromMenu(options?: UpdateCheckOptions): void {
  void options
  // Desktop updates are managed outside the app.
}

export function downloadUpdate(): void {
  // Downloads are owned by the Python updater.
}

export function quitAndInstall(): void {
  // The Python updater installs after the user quits.
}

export function isQuittingForUpdate(): boolean {
  return updater.isQuittingForUpdate()
}

export async function getLinuxPackageInstallInstructions(): Promise<LinuxPackageInstallInstructions> {
  return updater.getLinuxPackageInstallInstructions()
}

export async function showLinuxPackage(): Promise<void> {
  return updater.showLinuxPackage()
}

export async function listAvailableReleaseBuilds(
  channel: ReleaseChannel,
  options?: ReleaseBuildListOptions
): Promise<ReleaseBuild[]> {
  void channel
  void options
  return []
}

export function dismissNudge(): void {
  updater.dismissNudge()
}

export function dismissAvailableUpdate(): void {
  updater.dismissAvailableUpdate()
}

export function setupAutoUpdater(mainWindow: BrowserWindow, opts?: UpdaterSetupOptions): void {
  void mainWindow
  void opts
}
