import { createRoot } from 'react-dom/client'
import { i18n } from '@/i18n/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { OrchestrationStatusRoster } from './OrchestrationStatusRoster'
import type { OrchestrationStatusRow } from './orchestration-status-rows'
import '@/assets/main.css'

const rows: OrchestrationStatusRow[] = [
  {
    paneKey: 'a',
    dispatchId: 'a',
    task: '로그인 오류 수정',
    provider: 'codex',
    model: 'gpt-6',
    sessionId: 'a',
    connectionId: null,
    state: 'working'
  },
  {
    paneKey: 'b',
    dispatchId: 'b',
    task: '수정된 인증 흐름 검토',
    provider: 'claude',
    model: 'claude-sonnet',
    sessionId: 'b',
    connectionId: null,
    state: 'working'
  },
  {
    paneKey: 'c',
    dispatchId: 'c',
    task: '회귀 테스트 실행',
    provider: 'codex',
    model: 'gpt-6-mini',
    sessionId: 'c',
    connectionId: null,
    state: 'done'
  },
  {
    paneKey: 'd',
    dispatchId: 'd',
    task: '원격 서버 로그 확인',
    provider: 'codex',
    model: 'gpt-6',
    sessionId: 'd',
    connectionId: 'ssh',
    state: 'unverifiable'
  }
]
await i18n.changeLanguage('ko')
const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <TooltipProvider>
      <main className="mx-auto flex h-screen max-w-4xl flex-col bg-background p-4 text-foreground">
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          에이전트 작업 현황 패널 · 검증용 예시 데이터
        </div>
        <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
          로그인 오류를 수정하고 다른 에이전트에게 검토와 테스트를 맡겨줘.
        </div>
        <OrchestrationStatusRoster
          rows={rows}
          usage={{
            sessions: [
              { provider: 'codex', sessionId: 'a', totalTokens: 12400, model: 'gpt-6' },
              { provider: 'claude', sessionId: 'b', totalTokens: 8100, model: 'claude-sonnet' },
              { provider: 'codex', sessionId: 'c', totalTokens: 10700, model: 'gpt-6-mini' }
            ],
            availability: { codex: 'ready', claude: 'ready' }
          }}
        />
      </main>
    </TooltipProvider>
  )
}
