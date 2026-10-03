import { useState } from 'react'
import { Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { CommunitySkillsDialog } from './CommunitySkillsDialog'

export function CommunitySkillsEntry(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Globe className="size-3.5" />
        {translate('communitySkills.entry', 'Community skills')}
      </Button>
      {open ? <CommunitySkillsDialog onOpenChange={setOpen} /> : null}
    </>
  )
}
