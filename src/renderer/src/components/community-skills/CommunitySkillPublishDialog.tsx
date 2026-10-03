import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { skillAgentLabel } from '@/components/skills/skill-agent-filter'
import {
  COMMUNITY_SKILL_SUPPORTED_AGENTS,
  communitySkillPublishSchema,
  type CommunitySkillMetadata,
  type CommunitySkillPublishInput,
  type CommunitySkillsApi
} from '../../../../shared/community-skills'
import { readCommunitySkillMarkdown } from './community-skill-markdown-file'

export function CommunitySkillPublishDialog({
  api,
  skill,
  onClose,
  onPublished
}: {
  api: CommunitySkillsApi
  skill?: CommunitySkillMetadata
  onClose: () => void
  onPublished: (skill: CommunitySkillMetadata) => void
}): React.JSX.Element {
  const [name, setName] = useState(skill?.name ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [agents, setAgents] = useState<CommunitySkillPublishInput['supportedAgents']>(
    skill?.supportedAgents ?? ['codex', 'claude', 'openclaude', 'grok']
  )
  const [body, setBody] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileAttempt = useRef(0)
  const importFile = async (file: File | undefined): Promise<void> => {
    const attempt = ++fileAttempt.current
    setBody(null)
    setError(null)
    if (!file) {
      setReading(false)
      return
    }
    setReading(true)
    try {
      const value = await readCommunitySkillMarkdown(file)
      if (attempt === fileAttempt.current) {
        setBody(value)
      }
    } catch (cause) {
      if (attempt === fileAttempt.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : translate('communitySkills.fileReadFailed', 'Could not read this Markdown file.')
        )
      }
    } finally {
      if (attempt === fileAttempt.current) {
        setReading(false)
      }
    }
  }
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy || reading || body === null) {
      return
    }
    const parsed = communitySkillPublishSchema.safeParse({
      ...(skill ? { skillId: skill.id } : {}),
      name,
      description,
      body,
      supportedAgents: agents
    })
    if (!parsed.success) {
      setError(
        translate(
          'communitySkills.publishInvalid',
          'Use a lowercase skill name of 1–64 characters, a description of at most 500 characters, and at least one supported agent.'
        )
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      onPublished(await api.publish(parsed.data))
      onClose()
    } catch {
      setError(
        translate(
          'communitySkills.publishFailed',
          'Could not publish. Check your account and Markdown content, then retry.'
        )
      )
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
        <div className="scrollbar-sleek max-h-[75vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {skill
                ? translate('communitySkills.newVersion', 'Publish new version')
                : translate('communitySkills.publishSkill', 'Publish skill')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'communitySkills.publishDescription',
                'Publish public Markdown instructions only. Scripts, supporting files and declared dependencies are unsupported. Each publish creates an immutable version.'
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void submit(event)} className="space-y-3" noValidate>
            <div className="space-y-1">
              <Label htmlFor="community-skill-name">
                {translate('communitySkills.skillName', 'Skill name')}
              </Label>
              <Input
                id="community-skill-name"
                value={name}
                maxLength={64}
                disabled={busy || Boolean(skill)}
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => setName(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {translate(
                  'communitySkills.skillNameHint',
                  '1–64 lowercase letters, numbers or hyphens, starting with a letter or number.'
                )}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="community-skill-description">
                {translate('communitySkills.description', 'Description')}
              </Label>
              <Textarea
                id="community-skill-description"
                value={description}
                maxLength={500}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <fieldset className="space-y-2" disabled={busy}>
              <legend className="text-sm font-medium">
                {translate('communitySkills.agents', 'Supported agents')}
              </legend>
              <div className="flex flex-wrap gap-3">
                {COMMUNITY_SKILL_SUPPORTED_AGENTS.map((agent) => (
                  <div key={agent} className="flex items-center gap-2">
                    <Checkbox
                      id={`community-publish-${agent}`}
                      checked={agents.includes(agent)}
                      onCheckedChange={(checked) =>
                        setAgents((previous) =>
                          checked === true
                            ? [...previous, agent]
                            : previous.filter((value) => value !== agent)
                        )
                      }
                    />
                    <Label htmlFor={`community-publish-${agent}`}>{skillAgentLabel(agent)}</Label>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1">
              <Label htmlFor="community-markdown-file">
                {translate('communitySkills.markdownFile', 'Markdown file')}
              </Label>
              <Input
                id="community-markdown-file"
                type="file"
                accept=".md,.markdown,text/markdown"
                disabled={busy}
                onChange={(event) => void importFile(event.target.files?.[0])}
              />
              <p className="text-xs text-muted-foreground">
                {translate(
                  'communitySkills.fileHint',
                  'UTF-8 Markdown, at most 64 KiB. Review the exact content before publishing.'
                )}
              </p>
            </div>
            {reading ? (
              <p role="status" className="text-sm text-muted-foreground">
                {translate('communitySkills.readingFile', 'Reading Markdown…')}
              </p>
            ) : null}
            {body !== null ? (
              <pre className="scrollbar-sleek max-h-[30vh] overflow-auto rounded-md border border-border bg-editor-surface p-3 font-mono text-xs whitespace-pre-wrap break-words">
                {body}
              </pre>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={busy || reading || body === null}>
              {busy
                ? translate('communitySkills.publishing', 'Publishing…')
                : translate('communitySkills.publish', 'Publish to community')}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
