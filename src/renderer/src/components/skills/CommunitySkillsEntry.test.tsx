// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  CommunitySkillMetadata,
  CommunitySkillsApi
} from '../../../../shared/community-skills'
import { SkillsPageHeader } from './SkillsPageHeader'
import { CommunitySkillsEntry } from '../community-skills/CommunitySkillsEntry'

const metadata: CommunitySkillMetadata = {
  id: '11111111-1111-4111-8111-111111111111',
  author: 'alice',
  name: 'review-code',
  description: 'Review a change',
  version: 2,
  digest: 'a'.repeat(64),
  supportedAgents: ['codex', 'claude'],
  updatedAt: '2026-10-04T00:00:00Z'
}

function setup(overrides: Partial<CommunitySkillsApi> = {}, available = true) {
  const api = {
    status: vi.fn().mockResolvedValue({ configured: true, author: null }),
    search: vi.fn().mockResolvedValue({ items: [metadata], hasMore: false }),
    readVersion: vi.fn().mockImplementation(async ({ version }) => ({
      ...metadata,
      version,
      body: '# Instructions\n<script>alert(1)</script>'
    })),
    register: vi.fn().mockResolvedValue({ configured: true, author: 'alice' }),
    login: vi.fn().mockResolvedValue({ configured: true, author: 'alice' }),
    logout: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue({ ...metadata, version: 3 }),
    hide: vi.fn().mockResolvedValue(undefined),
    report: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } satisfies CommunitySkillsApi
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { skills: available ? { community: api } : {} }
  })
  const share = vi.fn()
  render(
    <TooltipProvider>
      <SkillsPageHeader
        skillCount={1}
        sourceEntries={[]}
        scannedSourceCount={0}
        hostLabel={null}
        onClose={vi.fn()}
        onStartShare={share}
        deleteSupported={false}
        deleteUnsupportedReason={null}
        onStartDelete={vi.fn()}
        onInstallFromLink={vi.fn()}
        onManageInstalls={vi.fn()}
        onOpenSharedLinks={vi.fn()}
      />
    </TooltipProvider>
  )
  expect(screen.queryByRole('button', { name: 'Community skills' })).toBeNull()
  render(<CommunitySkillsEntry />)
  fireEvent.click(screen.getByRole('button', { name: 'Community skills' }))
  return { api, share }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Independent community catalog', () => {
  it('browses publicly and previews a pinned version as safe text without installing', async () => {
    const { api } = setup()
    fireEvent.click(await screen.findByRole('button', { name: /alice\/review-code/ }))
    expect(await screen.findByText(/# Instructions\s+<script>alert\(1\)<\/script>/)).toBeTruthy()
    expect(api.readVersion).toHaveBeenCalledWith({ id: metadata.id, version: 2 })
    expect(screen.getAllByText('Codex, Claude').length).toBeGreaterThan(0)
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText(/No skill files are installed/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hide skill' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Report skill' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Version to preview'), { target: { value: '1' } })
    await waitFor(() =>
      expect(api.readVersion).toHaveBeenLastCalledWith({ id: metadata.id, version: 1 })
    )
    expect(await screen.findByText('Version 1')).toBeTruthy()
  })

  it('paginates metadata and resets the offset for a new search', async () => {
    const search = vi.fn().mockResolvedValue({ items: [metadata], hasMore: true })
    setup({ search })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(search).toHaveBeenLastCalledWith({ query: '', offset: 20 }))
    fireEvent.change(screen.getByLabelText('Search community skills'), {
      target: { value: 'review' }
    })
    await waitFor(() => expect(search).toHaveBeenLastCalledWith({ query: 'review', offset: 0 }))
  })

  it('offers retry after a failed search', async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ items: [metadata], hasMore: false })
    setup({ search })
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }))
    expect(await screen.findByRole('button', { name: /alice\/review-code/ })).toBeTruthy()
  })

  it('keeps sharing available when the optional API is absent', async () => {
    const { share } = setup({}, false)
    expect(await screen.findByText(/Community skills are unavailable/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Share skills' }))
    expect(share).toHaveBeenCalledOnce()
  })

  it('registers and clears credentials, then exposes owner actions and signs out', async () => {
    const { api } = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create account instead' }))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith({
        username: 'alice',
        password: 'long-password-123'
      })
    )
    expect(await screen.findByText('Signed in as alice')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: /alice\/review-code/ }))
    expect(await screen.findByRole('button', { name: 'Publish new version' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hide skill' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(api.logout).toHaveBeenCalledOnce())
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hide skill' })).toBeNull()
  })

  it('validates account bounds before sending credentials and permits retry', async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new Error('Invalid credentials'))
      .mockResolvedValue({ configured: true, author: 'alice' })
    setup({ login })
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(login).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('Could not sign in. Check your credentials and try again.')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Signed in as alice')).toBeTruthy()
  })

  it('imports bounded Markdown, previews it and publishes a new immutable version', async () => {
    const { api } = setup({
      status: vi.fn().mockResolvedValue({ configured: true, author: 'alice' })
    })
    fireEvent.click(await screen.findByRole('button', { name: /alice\/review-code/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish new version' }))
    const file = new File(['# New instructions'], 'SKILL.md', { type: 'text/markdown' })
    fireEvent.change(screen.getByLabelText('Markdown file'), { target: { files: [file] } })
    expect(await screen.findByText('# New instructions')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish to community' }))
    await waitFor(() =>
      expect(api.publish).toHaveBeenCalledWith({
        skillId: metadata.id,
        name: metadata.name,
        description: metadata.description,
        body: '# New instructions',
        supportedAgents: ['codex', 'claude']
      })
    )
    expect(await screen.findByText('Published alice/review-code · version 3.')).toBeTruthy()
  })

  it('rejects oversized uploads before reading them', async () => {
    const { api } = setup({
      status: vi.fn().mockResolvedValue({ configured: true, author: 'alice' })
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Publish skill' }))
    fireEvent.change(screen.getByLabelText('Markdown file'), {
      target: { files: [new File(['x'.repeat(65537)], 'SKILL.md')] }
    })
    expect(await screen.findByText('Choose a Markdown file of at most 64 KiB.')).toBeTruthy()
    expect(api.publish).not.toHaveBeenCalled()
  })

  it('allows signed-in reports and confirms owner hiding', async () => {
    const { api } = setup({
      status: vi.fn().mockResolvedValue({ configured: true, author: 'alice' })
    })
    fireEvent.click(await screen.findByRole('button', { name: /alice\/review-code/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Report skill' }))
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Misleading instructions' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    await waitFor(() =>
      expect(api.report).toHaveBeenCalledWith({
        id: metadata.id,
        reason: 'Misleading instructions'
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hide skill' }))
    expect(api.hide).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm hide' }))
    await waitFor(() => expect(api.hide).toHaveBeenCalledWith({ id: metadata.id }))
  })

  it('offers reports but no owner actions to another signed-in author', async () => {
    setup({ status: vi.fn().mockResolvedValue({ configured: true, author: 'bob' }) })
    fireEvent.click(await screen.findByRole('button', { name: /alice\/review-code/ }))
    expect(await screen.findByRole('button', { name: 'Report skill' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hide skill' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish new version' })).toBeNull()
  })

  it('publishes a new skill with selected compatibility and retains the preview after failure', async () => {
    const publish = vi
      .fn()
      .mockRejectedValueOnce(new Error('service unavailable'))
      .mockResolvedValue(metadata)
    setup({ status: vi.fn().mockResolvedValue({ configured: true, author: 'alice' }), publish })
    fireEvent.click(await screen.findByRole('button', { name: 'Publish skill' }))
    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'review-code' } })
    fireEvent.click(screen.getByLabelText('Claude'))
    fireEvent.click(screen.getByLabelText('OpenClaude'))
    fireEvent.click(screen.getByLabelText('Grok'))
    fireEvent.change(screen.getByLabelText('Markdown file'), {
      target: { files: [new File(['Review carefully'], 'SKILL.md')] }
    })
    await screen.findByText('Review carefully')
    fireEvent.click(screen.getByRole('button', { name: 'Publish to community' }))
    expect(await screen.findByText(/Could not publish/)).toBeTruthy()
    expect(screen.getByText('Review carefully')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish to community' }))
    await screen.findByText('Published alice/review-code · version 2.')
    expect(publish).toHaveBeenLastCalledWith({
      name: 'review-code',
      description: '',
      body: 'Review carefully',
      supportedAgents: ['codex']
    })
  })

  it('ignores results from an older search', async () => {
    let resolveOld!: (value: { items: CommunitySkillMetadata[]; hasMore: boolean }) => void
    const old = new Promise<{ items: CommunitySkillMetadata[]; hasMore: boolean }>((resolve) => {
      resolveOld = resolve
    })
    const search = vi
      .fn()
      .mockReturnValueOnce(old)
      .mockResolvedValue({ items: [{ ...metadata, name: 'new-search' }], hasMore: false })
    setup({ search })
    await waitFor(() => expect(search).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByLabelText('Search community skills'), { target: { value: 'new' } })
    await screen.findByRole('button', { name: /new-search/ })
    resolveOld({ items: [metadata], hasMore: false })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /alice\/review-code/ })).toBeNull()
    )
    expect(screen.getByRole('button', { name: /new-search/ })).toBeTruthy()
  })

  it('retries a failed status request without losing the entry', async () => {
    setup({
      status: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ configured: true, author: null })
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Retry connection' }))
    expect(await screen.findByRole('button', { name: /alice\/review-code/ })).toBeTruthy()
  })

  it('shows unavailable when the service is unconfigured', async () => {
    const { api } = setup({
      status: vi.fn().mockResolvedValue({ configured: false, author: null })
    })
    expect(await screen.findByText(/Community skills are unavailable/)).toBeTruthy()
    expect(api.search).not.toHaveBeenCalled()
  })
})
