import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'

export function OrchestrationRunPicker({
  options,
  runId,
  onSelect
}: {
  options: readonly { id: string; label: string }[]
  runId: string | null
  onSelect: (id: string | null) => void
}): React.JSX.Element {
  const label = options.find((option) => option.id === runId)?.label
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="max-w-full justify-start"
          aria-label={translate('components.orchestration-status.connect', 'Connect a task group')}
        >
          <Link2 aria-hidden="true" />
          <span className="truncate">
            {label || translate('components.orchestration-status.connect', 'Connect a task group')}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={runId ?? ''} onValueChange={(id) => onSelect(id || null)}>
          <DropdownMenuRadioItem value="">
            {translate('components.orchestration-status.direct', 'Tasks assigned from this pane')}
          </DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
