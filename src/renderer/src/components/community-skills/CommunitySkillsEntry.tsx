import { useState } from 'react'
import { Globe } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { CommunitySkillsDialog } from './CommunitySkillsDialog'

export function CommunitySkillsEntry(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight text-worktree-sidebar-foreground/60 transition-colors hover:bg-worktree-sidebar-foreground/8"
      >
        <Globe className="size-4 shrink-0 text-worktree-sidebar-foreground/30" />
        <span className="flex-1">{translate('communitySkills.entry', 'Community skills')}</span>
      </button>
      {open ? <CommunitySkillsDialog onOpenChange={setOpen} /> : null}
    </>
  )
}
