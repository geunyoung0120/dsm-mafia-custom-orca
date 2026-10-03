import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { skillAgentLabel } from '@/components/skills/skill-agent-filter'
import type {
  CommunitySkillMetadata,
  CommunitySkillsApi,
  CommunitySkillVersion
} from '../../../../shared/community-skills'

export type CommunitySkillPreviewProps = {
  api: CommunitySkillsApi
  skill: CommunitySkillMetadata
  initialVersion?: number
  agent?: string
  onChoose?: (version: CommunitySkillVersion) => void
}

export function CommunitySkillPreview({
  api,
  skill,
  initialVersion,
  agent,
  onChoose
}: CommunitySkillPreviewProps): React.JSX.Element {
  const [version, setVersion] = useState(String(initialVersion ?? skill.version))
  const [body, setBody] = useState<CommunitySkillVersion | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const requestedVersion = Number(version)
  const validVersion =
    Number.isInteger(requestedVersion) && requestedVersion >= 1 && requestedVersion <= skill.version
  useEffect(() => {
    let current = true
    setBody(null)
    setFailed(false)
    if (!validVersion) {
      return
    }
    void api
      .readVersion({ id: skill.id, version: requestedVersion })
      .then((value) => {
        if (value.id !== skill.id || value.version !== requestedVersion) {
          throw new Error('Version mismatch')
        }
        if (current) {
          setBody(value)
        }
      })
      .catch(() => {
        if (current) {
          setFailed(true)
        }
      })
    return () => {
      current = false
    }
  }, [api, skill.id, requestedVersion, validVersion, attempt])
  const ready = body?.version === requestedVersion && body.id === skill.id ? body : null
  const supported = !agent || ready?.supportedAgents.some((value) => value === agent)
  return (
    <section
      className="min-w-0 space-y-3"
      aria-label={translate('communitySkills.preview', 'Skill preview')}
    >
      <h3 className="break-words text-sm font-semibold">
        {skill.author}/{skill.name}
      </h3>
      <p className="whitespace-pre-wrap text-sm">{ready?.description ?? skill.description}</p>
      <p className="text-xs text-muted-foreground">
        {(ready ?? skill).supportedAgents.map(skillAgentLabel).join(', ')}
      </p>
      <div className="space-y-1">
        <Label htmlFor="community-preview-version">
          {translate('communitySkills.previewVersion', 'Version to preview')}
        </Label>
        <Input
          id="community-preview-version"
          type="number"
          min={1}
          max={skill.version}
          value={version}
          aria-invalid={!validVersion}
          onChange={(event) => setVersion(event.target.value)}
        />
      </div>
      {!validVersion ? (
        <p role="alert" className="text-sm text-destructive">
          {translate(
            'communitySkills.validVersion',
            'Choose an available positive version number.'
          )}
        </p>
      ) : failed ? (
        <>
          <p role="alert" className="text-sm text-destructive">
            {translate(
              'communitySkills.previewFailed',
              'Could not load this version. It may be hidden or unavailable.'
            )}
          </p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            {translate('communitySkills.retryPreview', 'Retry preview')}
          </Button>
        </>
      ) : ready ? (
        <>
          <p className="text-xs text-muted-foreground">
            {translate('communitySkills.version', 'Version {{version}}', {
              version: ready.version
            })}
          </p>
          <pre className="scrollbar-sleek max-h-[40vh] overflow-auto rounded-md border border-border bg-editor-surface p-3 font-mono text-xs whitespace-pre-wrap break-words">
            {ready.body}
          </pre>
          {onChoose ? (
            <>
              {!supported ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {translate(
                    'communitySkills.unsupported',
                    'This version does not support the selected agent.'
                  )}
                </p>
              ) : null}
              <Button disabled={!supported} onClick={() => onChoose(ready)}>
                {translate('communitySkills.choose', 'Choose this version')}
              </Button>
            </>
          ) : null}
        </>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {translate('communitySkills.loadingPreview', 'Loading Markdown…')}
        </p>
      )}
    </section>
  )
}
