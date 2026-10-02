import { describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  setupAutoUpdater: vi.fn(),
  checkForUpdates: vi.fn(),
  checkForUpdatesFromMenu: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  listAvailableReleaseBuilds: vi.fn()
}))
vi.mock('./updater/updater-setup', () => ({
  UpdaterSetup: class {
    constructor() {
      return service
    }
  }
}))
vi.mock('electron', () => ({ shell: { openExternal: vi.fn().mockResolvedValue(undefined) } }))

describe('custom distribution update ownership', () => {
  it('never invokes the official desktop updater', async () => {
    const updater = await import('./updater')
    updater.checkForUpdates()
    updater.checkForUpdatesFromMenu()
    updater.downloadUpdate()
    updater.quitAndInstall()
    expect(await updater.listAvailableReleaseBuilds('stable')).toEqual([])
    for (const call of Object.values(service)) {
      expect(call).not.toHaveBeenCalled()
    }
  })
})
