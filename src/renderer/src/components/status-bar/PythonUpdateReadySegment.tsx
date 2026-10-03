import { CheckCircle2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from './status-bar-context-menu-policy'

export function PythonUpdateReadySegment({ version }: { version: string }): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-foreground hover:bg-accent/70"
          aria-label="업데이트 준비됨"
          {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
        >
          <CheckCircle2 className="size-3 text-primary" />
          <span className="whitespace-nowrap text-[11px]">업데이트 준비됨</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}>
        <div className="space-y-2 text-sm">
          <p className="font-medium">업데이트 준비됨</p>
          <p className="text-xs text-muted-foreground">v{version}</p>
          <p>작업을 저장한 뒤 Orca를 완전히 종료하면 준비된 업데이트가 설치됩니다.</p>
          <p className="text-xs text-muted-foreground">
            설치 완료 알림을 확인한 뒤 다시 실행하세요.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
