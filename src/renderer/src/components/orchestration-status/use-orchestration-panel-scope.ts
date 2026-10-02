import { useSyncExternalStore } from 'react'

const EVENT = 'orca-orchestration-panel-scope'
const PREFIX = 'orca.orchestration-panel.run:'
const memory = new Map<string, string | null>()

function read(paneKey: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + paneKey)
  } catch {
    return memory.get(paneKey) ?? null
  }
}
function subscribe(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}
/** View preference only: changing this never transfers coordinator or dispatch authority. */
export function useOrchestrationPanelScope(
  paneKey: string
): [string | null, (runId: string | null) => void] {
  const runId = useSyncExternalStore(
    subscribe,
    () => read(paneKey),
    () => null
  )
  const select = (id: string | null): void => {
    memory.set(paneKey, id)
    try {
      if (id) {
        window.localStorage.setItem(PREFIX + paneKey, id)
      } else {
        window.localStorage.removeItem(PREFIX + paneKey)
      }
    } catch {
      // A restricted renderer can still keep the preference for its lifetime.
    }
    window.dispatchEvent(new Event(EVENT))
  }
  return [runId, select]
}
