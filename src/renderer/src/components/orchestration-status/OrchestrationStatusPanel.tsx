import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { buildOrchestrationStatusRows, orchestrationRunOptions } from './orchestration-status-rows'
import { useOrchestrationPanelScope } from './use-orchestration-panel-scope'
import { OrchestrationRunPicker } from './OrchestrationRunPicker'
import { translate } from '@/i18n/i18n'
import { useOrchestrationStatusUsage } from './use-orchestration-status-usage'
import { OrchestrationStatusRoster } from './OrchestrationStatusRoster'

const EMPTY_MAP = {}

export function OrchestrationStatusPanel({
  paneKey,
  enabled = true
}: {
  paneKey: string
  enabled?: boolean
}): React.JSX.Element | null {
  const stateSource = useAppStore(
    useShallow((state) => ({
      live: state.agentStatusByPaneKey ?? EMPTY_MAP,
      retained: state.retainedAgentsByPaneKey ?? EMPTY_MAP,
      contexts: state.runtimeAgentOrchestrationByPaneKey ?? EMPTY_MAP,
      closedTabs: state.recentlyClosedAgentStatusTabIds ?? EMPTY_MAP,
      retiredPanes: state.recentlyRetiredAgentStatusPaneKeys ?? EMPTY_MAP,
      tabs: state.tabsByWorktree ?? EMPTY_MAP,
      epoch: state.agentStatusEpoch
    }))
  )
  const source = useMemo(
    () => ({
      ...stateSource,
      openTabIds: new Set(
        Object.values(stateSource.tabs).flatMap((tabs) => tabs.map((tab) => tab.id))
      )
    }),
    [stateSource]
  )
  const [runId, selectRun] = useOrchestrationPanelScope(paneKey)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [enablingProvider, setEnablingProvider] = useState<string | null>(null)
  const [activationFailed, setActivationFailed] = useState(false)
  const options = useMemo(() => orchestrationRunOptions(source), [source])
  const rows = useMemo(
    () =>
      enabled ? buildOrchestrationStatusRows({ parentPaneKey: paneKey, runId, ...source }) : [],
    [paneKey, runId, enabled, source]
  )
  const usage = useOrchestrationStatusUsage(rows, enabled, refreshVersion)
  const enableUsage = async (provider: string): Promise<void> => {
    if (enablingProvider) {
      return
    }
    setEnablingProvider(provider)
    setActivationFailed(false)
    try {
      const api =
        provider === 'claude'
          ? window.api?.claudeUsage
          : provider === 'codex'
            ? window.api?.codexUsage
            : provider === 'opencode'
              ? window.api?.openCodeUsage
              : undefined
      if (!api) {
        throw new Error('Usage provider unavailable')
      }
      const result = await api.setEnabled({ enabled: true })
      if (!result?.enabled) {
        throw new Error('Usage collection not enabled')
      }
      setRefreshVersion((value) => value + 1)
    } catch {
      setActivationFailed(true)
    } finally {
      setEnablingProvider(null)
    }
  }
  if (!enabled) {
    return null
  }
  return (
    <>
      <OrchestrationStatusRoster
        rows={rows}
        usage={usage}
        enablingProvider={enablingProvider}
        onEnableUsage={(provider) => {
          void enableUsage(provider)
        }}
        controls={
          options.length ? (
            <OrchestrationRunPicker options={options} runId={runId} onSelect={selectRun} />
          ) : undefined
        }
      />
      {activationFailed ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          {translate(
            'components.orchestration-status.enableFailed',
            'Could not enable usage collection. Try again.'
          )}
        </p>
      ) : null}
    </>
  )
}
