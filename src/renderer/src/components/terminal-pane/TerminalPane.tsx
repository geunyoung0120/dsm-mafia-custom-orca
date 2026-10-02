import { forwardRef } from 'react'
import { TerminalPaneSurface } from './TerminalPaneSurface'
import { useTerminalPaneController } from './use-terminal-pane-controller'
import type { TerminalPaneHandle, TerminalPaneProps } from './terminal-pane-types'
import { OrchestrationStatusPanel } from '@/components/orchestration-status/OrchestrationStatusPanel'
import { makePaneKey } from '../../../../shared/stable-pane-id'

export type { TerminalPaneHandle } from './terminal-pane-types'

function TerminalPane(
  props: TerminalPaneProps,
  ref: React.ForwardedRef<TerminalPaneHandle>
): React.JSX.Element {
  const controller = useTerminalPaneController(props, ref)
  const { activePane, activePaneIsChatLeaf, tabId, isRendererVisible } = controller
  return (
    <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col">
      <div className="relative min-h-0 min-w-0 flex-1">
        <TerminalPaneSurface controller={controller} />
      </div>
      {activePane && !activePaneIsChatLeaf ? (
        <div className="shrink-0 bg-background px-3">
          <OrchestrationStatusPanel
            paneKey={makePaneKey(tabId, activePane.leafId)}
            enabled={isRendererVisible}
          />
        </div>
      ) : null}
    </div>
  )
}

export default forwardRef(TerminalPane)
