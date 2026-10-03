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
import {
  communitySkillCredentialsSchema,
  type CommunitySkillsApi,
  type CommunitySkillsStatus
} from '../../../../shared/community-skills'

export function CommunitySkillAuthDialog({
  api,
  onClose,
  onAuthenticated
}: {
  api: CommunitySkillsApi
  onClose: () => void
  onAuthenticated: (status: CommunitySkillsStatus) => void
}): React.JSX.Element {
  const [register, setRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) {
      return
    }
    const parsed = communitySkillCredentialsSchema.safeParse({ username, password })
    if (!parsed.success) {
      setError(
        translate(
          'communitySkills.credentialsInvalid',
          'Use a lowercase username of 3–32 characters and a password of 12–256 characters.'
        )
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      const status = await (register ? api.register(parsed.data) : api.login(parsed.data))
      setUsername('')
      setPassword('')
      onAuthenticated(status)
      onClose()
    } catch {
      setError(
        register
          ? translate(
              'communitySkills.registrationFailed',
              'Could not create an account. Try another username or retry.'
            )
          : translate(
              'communitySkills.loginFailed',
              'Could not sign in. Check your credentials and try again.'
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
        <DialogHeader>
          <DialogTitle>
            {register
              ? translate('communitySkills.createAccount', 'Create account')
              : translate('communitySkills.signIn', 'Sign in')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'communitySkills.catalogAccount',
              'Use a community catalog account. Your session ends when Orca restarts.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(event) => void submit(event)} noValidate>
          <div className="space-y-1">
            <Label htmlFor="community-username">
              {translate('communitySkills.username', 'Username')}
            </Label>
            <Input
              id="community-username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              maxLength={32}
              disabled={busy}
              aria-invalid={Boolean(error)}
              onChange={(event) => setUsername(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {translate(
                'communitySkills.usernameHint',
                '3–32 lowercase letters, numbers, hyphens or underscores.'
              )}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="community-password">
              {translate('communitySkills.password', 'Password')}
            </Label>
            <Input
              id="community-password"
              type="password"
              autoComplete={register ? 'new-password' : 'current-password'}
              value={password}
              maxLength={256}
              disabled={busy}
              aria-invalid={Boolean(error)}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {translate('communitySkills.passwordHint', '12–256 characters.')}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy
              ? translate('communitySkills.authPending', 'Connecting…')
              : register
                ? translate('communitySkills.createAccount', 'Create account')
                : translate('communitySkills.continue', 'Continue')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setRegister((value) => !value)
              setError(null)
            }}
          >
            {register
              ? translate('communitySkills.signInInstead', 'Sign in instead')
              : translate('communitySkills.createInstead', 'Create account instead')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
