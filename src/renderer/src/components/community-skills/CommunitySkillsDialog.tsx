import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { skillAgentLabel } from '@/components/skills/skill-agent-filter'
import type {
  CommunitySkillMetadata,
  CommunitySkillsApi
} from '../../../../shared/community-skills'
import { CommunitySkillAuthDialog } from './CommunitySkillAuthDialog'
import { CommunitySkillPublishDialog } from './CommunitySkillPublishDialog'
import { CommunitySkillModerationDialog } from './CommunitySkillModerationDialog'
import { CommunitySkillPreview, type CommunitySkillPreviewProps } from './CommunitySkillPreview'
import { useCommunitySkillsCatalog } from './use-community-skills-catalog'

type CommunitySkillsDialogProps = {
  onOpenChange: (open: boolean) => void
  api?: CommunitySkillsApi
  initialSkill?: CommunitySkillMetadata
  initialVersion?: number
  agent?: string
  onChoose?: CommunitySkillPreviewProps['onChoose']
}

export function CommunitySkillsDialog({
  onOpenChange,
  api: suppliedApi,
  initialSkill,
  initialVersion,
  agent,
  onChoose
}: CommunitySkillsDialogProps): React.JSX.Element {
  const skills: (typeof window.api.skills & { community?: CommunitySkillsApi }) | undefined =
    window.api?.skills
  const api = suppliedApi ?? skills?.community
  const catalog = useCommunitySkillsCatalog(api)
  const [selected, setSelected] = useState<CommunitySkillMetadata | null>(initialSkill ?? null)
  const [authOpen, setAuthOpen] = useState(false)
  const [publish, setPublish] = useState<{ skill?: CommunitySkillMetadata } | null>(null)
  const [moderation, setModeration] = useState<'hide' | 'report' | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [accountFailed, setAccountFailed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const author = catalog.status?.author
  const owner = Boolean(author && selected?.author === author)
  const configured = Boolean(api && catalog.status?.configured)
  const logout = async (): Promise<void> => {
    if (!api || signingOut) {
      return
    }
    setSigningOut(true)
    setAccountFailed(false)
    try {
      await api.logout()
      catalog.setStatus({ configured: true, author: null })
    } catch {
      setAccountFailed(true)
    } finally {
      setSigningOut(false)
    }
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <div className="scrollbar-sleek max-h-[75vh] space-y-4 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{translate('communitySkills.entry', 'Community skills')}</DialogTitle>
            <DialogDescription>
              {translate(
                'communitySkills.noInstall',
                'Preview public Markdown instructions, then choose them in the & picker in chat. No skill files are installed. Community content is untrusted and keeps existing tool permissions.'
              )}
            </DialogDescription>
          </DialogHeader>
          {!api || catalog.status?.configured === false ? (
            <p role="status" className="text-sm text-muted-foreground">
              {translate(
                'communitySkills.unavailable',
                'Community skills are unavailable in this client or are not configured.'
              )}
            </p>
          ) : catalog.statusFailed ? (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                {translate(
                  'communitySkills.statusFailed',
                  'Could not connect to the community catalog.'
                )}
              </p>
              <Button variant="outline" size="sm" onClick={catalog.retryStatus}>
                {translate('communitySkills.retryConnection', 'Retry connection')}
              </Button>
            </div>
          ) : !catalog.status ? (
            <p role="status" className="text-sm text-muted-foreground">
              {translate('communitySkills.connecting', 'Connecting to catalog…')}
            </p>
          ) : null}
          {configured && api ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {author ? (
                  <>
                    <p className="mr-auto text-xs text-muted-foreground">
                      {translate('communitySkills.signedIn', 'Signed in as {{author}}', { author })}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPublish({})}
                      disabled={signingOut}
                    >
                      {translate('communitySkills.publishSkill', 'Publish skill')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void logout()}
                      disabled={signingOut}
                    >
                      {signingOut
                        ? translate('communitySkills.signingOut', 'Signing out…')
                        : translate('communitySkills.signOut', 'Sign out')}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setAuthOpen(true)}>
                    {translate('communitySkills.signIn', 'Sign in')}
                  </Button>
                )}
              </div>
              {accountFailed ? (
                <p role="alert" className="text-sm text-destructive">
                  {translate('communitySkills.signOutFailed', 'Could not sign out. Please retry.')}
                </p>
              ) : null}
              {notice ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {notice}
                </p>
              ) : null}
              <div className="space-y-1">
                <Label htmlFor="community-search">
                  {translate('communitySkills.search', 'Search community skills')}
                </Label>
                <Input
                  id="community-search"
                  type="search"
                  maxLength={100}
                  value={catalog.query}
                  onChange={(event) => catalog.search(event.target.value)}
                />
              </div>
              <div className="grid min-w-0 gap-5 md:grid-cols-2">
                <section
                  aria-label={translate('communitySkills.results', 'Catalog results')}
                  className="min-w-0 space-y-3"
                >
                  {catalog.loading ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      {translate('communitySkills.searching', 'Searching catalog…')}
                    </p>
                  ) : catalog.searchFailed ? (
                    <>
                      <p role="alert" className="text-sm text-destructive">
                        {translate(
                          'communitySkills.searchFailed',
                          'Could not search the catalog. Please retry.'
                        )}
                      </p>
                      <Button variant="outline" size="sm" onClick={catalog.refresh}>
                        {translate('communitySkills.retrySearch', 'Retry search')}
                      </Button>
                    </>
                  ) : catalog.result ? (
                    <>
                      {catalog.result.items.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          {translate('communitySkills.empty', 'No community skills found.')}
                        </p>
                      ) : null}
                      <ul className="scrollbar-sleek max-h-[45vh] space-y-1 overflow-y-auto">
                        {catalog.result.items.map((skill) => (
                          <li
                            key={skill.id}
                            data-current={selected?.id === skill.id}
                            className="rounded-md data-[current=true]:bg-accent"
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-auto w-full whitespace-normal"
                              aria-pressed={selected?.id === skill.id}
                              data-current={selected?.id === skill.id}
                              onClick={() => {
                                setSelected(skill)
                                setNotice(null)
                              }}
                            >
                              <span className="flex w-full flex-col items-start gap-1">
                                <span className="break-words text-left">
                                  {skill.author}/{skill.name} · v{skill.version}
                                </span>
                                <span className="line-clamp-2 text-left text-xs text-muted-foreground">
                                  {skill.description}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {skill.supportedAgents.map(skillAgentLabel).join(', ')}
                                </span>
                              </span>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={catalog.loading || catalog.offset === 0}
                      onClick={() => catalog.setOffset(Math.max(0, catalog.offset - 20))}
                    >
                      {translate('communitySkills.previousPage', 'Previous page')}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {translate('communitySkills.page', 'Page {{page}}', {
                        page: catalog.offset / 20 + 1
                      })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        catalog.loading || !catalog.result?.hasMore || catalog.offset >= 10000
                      }
                      onClick={() => catalog.setOffset(catalog.offset + 20)}
                    >
                      {translate('communitySkills.nextPage', 'Next page')}
                    </Button>
                  </div>
                </section>
                {selected ? (
                  <div className="min-w-0 space-y-3">
                    <CommunitySkillPreview
                      key={`${selected.id}:${selected.version}`}
                      api={api}
                      skill={selected}
                      initialVersion={selected.id === initialSkill?.id ? initialVersion : undefined}
                      agent={agent}
                      onChoose={
                        onChoose
                          ? (version) => {
                              onChoose(version)
                              onOpenChange(false)
                            }
                          : undefined
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      {owner ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={signingOut}
                            onClick={() => setPublish({ skill: selected })}
                          >
                            {translate('communitySkills.newVersion', 'Publish new version')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={signingOut}
                            onClick={() => setModeration('hide')}
                          >
                            {translate('communitySkills.hide', 'Hide skill')}
                          </Button>
                        </>
                      ) : null}
                      {author ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={signingOut}
                          onClick={() => setModeration('report')}
                        >
                          {translate('communitySkills.report', 'Report skill')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {translate(
                      'communitySkills.selectPreview',
                      'Select a skill to preview its Markdown and version.'
                    )}
                  </p>
                )}
              </div>
              {authOpen ? (
                <CommunitySkillAuthDialog
                  api={api}
                  onClose={() => setAuthOpen(false)}
                  onAuthenticated={catalog.setStatus}
                />
              ) : null}
              {publish && author ? (
                <CommunitySkillPublishDialog
                  api={api}
                  skill={publish.skill}
                  onClose={() => setPublish(null)}
                  onPublished={(skill) => {
                    setSelected(skill)
                    catalog.refresh()
                    setNotice(
                      translate(
                        'communitySkills.published',
                        'Published {{author}}/{{name}} · version {{version}}.',
                        skill
                      )
                    )
                  }}
                />
              ) : null}
              {moderation && selected && author ? (
                <CommunitySkillModerationDialog
                  api={api}
                  skill={selected}
                  action={moderation}
                  onClose={() => setModeration(null)}
                  onDone={() => {
                    if (moderation === 'hide') {
                      setSelected(null)
                      catalog.refresh()
                    }
                    setNotice(
                      moderation === 'hide'
                        ? translate('communitySkills.hidden', 'Skill hidden.')
                        : translate('communitySkills.reported', 'Report sent.')
                    )
                  }}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
