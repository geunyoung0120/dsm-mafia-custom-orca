const base = require('../config/electron-builder.config.cjs')

// Preserve Orca's runtime/CLI executable layout; installation and user data are independent.
module.exports = {
  ...base,
  appId: 'io.github.geunyoung0120.orca-custom',
  publish: null,
  forceCodeSigning: false,
  files: [...base.files, '!distribution{,/**/*}'],
  mac: {
    ...base.mac,
    identity: '-',
    notarize: false,
    hardenedRuntime: false,
    extendInfo: { ...base.mac.extendInfo, CFBundleDisplayName: 'Orca Custom' },
    extraResources: [
      ...base.mac.extraResources,
      { from: 'distribution/build/custom-notifier.app', to: 'custom-notifier.app' }
    ]
  },
  win: { ...base.win, signtoolOptions: undefined },
  linux: { ...base.linux, desktop: { ...base.linux.desktop, entry: { Name: 'Orca Custom' } } }
}
