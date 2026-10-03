import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type {
  CommunitySkillMetadata,
  CommunitySkillsApi
} from '../../../../shared/community-skills'

export function CommunitySkillModerationDialog({
  api,
  skill,
  action,
  onClose,
  onDone
}: {
  api: CommunitySkillsApi
  skill: CommunitySkillMetadata
  action: 'hide' | 'report'
  onClose: () => void
  onDone: () => void
}): React.JSX.Element {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || (action === 'report' && (!reason.trim() || reason.length > 1000))) {
      return
    }
    setBusy(true)
    setFailed(false)
    try {
      await (action === 'hide'
        ? api.hide({ id: skill.id })
        : api.report({ id: skill.id, reason: reason.trim() }))
      onDone()
      onClose()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {action === 'hide'
              ? translate('communitySkills.hide', 'Hide skill')
              : translate('communitySkills.report', 'Report skill')}
          </DialogTitle>
          <DialogDescription>
            {action === 'hide'
              ? translate(
                  'communitySkills.hideDescription',
                  'Hide {{name}} from the public catalog. Existing references may no longer resolve.',
                  { name: `${skill.author}/${skill.name}` }
                )
              : translate(
                  'communitySkills.reportDescription',
                  'Describe the issue with {{name}} (at most 1000 characters).',
                  { name: `${skill.author}/${skill.name}` }
                )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(event) => void submit(event)}>
          {action === 'report' ? (
            <div className="space-y-1">
              <Label htmlFor="community-report-reason">
                {translate('communitySkills.reason', 'Reason')}
              </Label>
              <Textarea
                id="community-report-reason"
                value={reason}
                maxLength={1000}
                required
                disabled={busy}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          ) : null}
          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              {translate(
                'communitySkills.moderationFailed',
                'Could not complete this action. Check your account and retry.'
              )}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {translate('communitySkills.cancel', 'Cancel')}
            </Button>
            <Button
              type="submit"
              variant={action === 'hide' ? 'destructive' : 'default'}
              disabled={busy || (action === 'report' && !reason.trim())}
            >
              {busy
                ? translate('communitySkills.sending', 'Sending…')
                : action === 'hide'
                  ? translate('communitySkills.confirmHide', 'Confirm hide')
                  : translate('communitySkills.sendReport', 'Send report')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
