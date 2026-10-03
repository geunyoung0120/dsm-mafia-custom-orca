// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CommunitySkillMetadata,
  CommunitySkillsApi,
  CommunitySkillVersion
} from '../../../../shared/community-skills'
import { CommunitySkillPreview } from './CommunitySkillPreview'
import { readCommunitySkillMarkdown } from './community-skill-markdown-file'

const skill: CommunitySkillMetadata = {
  id: '11111111-1111-4111-8111-111111111111',
  author: 'alice',
  name: 'review-code',
  description: '',
  version: 2,
  digest: 'a'.repeat(64),
  supportedAgents: ['codex'],
  updatedAt: ''
}

function api(readVersion: CommunitySkillsApi['readVersion']): CommunitySkillsApi {
  return {
    status: vi.fn(),
    search: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    publish: vi.fn(),
    hide: vi.fn(),
    report: vi.fn(),
    readVersion
  }
}

afterEach(cleanup)

describe('Community preview selection', () => {
  it.each(['codex', 'claude', 'openclaude', 'grok'])(
    'chooses an explicitly previewed immutable version for %s',
    async (agent) => {
      const version: CommunitySkillVersion = {
        ...skill,
        supportedAgents: ['codex', 'claude', 'openclaude', 'grok'],
        version: 1,
        body: '# Old instructions'
      }
      const readVersion = vi.fn().mockResolvedValue(version)
      const choose = vi.fn()
      render(
        <CommunitySkillPreview
          api={api(readVersion)}
          skill={skill}
          initialVersion={1}
          agent={agent}
          onChoose={choose}
        />
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Choose this version' }))
      expect(readVersion).toHaveBeenCalledWith({ id: skill.id, version: 1 })
      expect(choose).toHaveBeenCalledWith(version)
    }
  )

  it('blocks choosing an incompatible provider using the previewed version metadata', async () => {
    const choose = vi.fn()
    render(
      <CommunitySkillPreview
        api={api(vi.fn().mockResolvedValue({ ...skill, body: 'instructions' }))}
        skill={skill}
        agent="grok"
        onChoose={choose}
      />
    )
    const button = await screen.findByRole('button', { name: 'Choose this version' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(choose).not.toHaveBeenCalled()
  })

  it('rejects a mismatched version and retries without making it selectable', async () => {
    const readVersion = vi
      .fn()
      .mockResolvedValueOnce({ ...skill, version: 1, body: 'wrong version' })
      .mockResolvedValue({ ...skill, body: 'correct version' })
    render(<CommunitySkillPreview api={api(readVersion)} skill={skill} onChoose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Choose this version' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }))
    expect(await screen.findByText('correct version')).toBeTruthy()
  })

  it('ignores a stale version response after the requested version changes', async () => {
    let resolveOld!: (value: CommunitySkillVersion) => void
    const old = new Promise<CommunitySkillVersion>((resolve) => {
      resolveOld = resolve
    })
    const readVersion = vi
      .fn()
      .mockReturnValueOnce(old)
      .mockResolvedValue({ ...skill, version: 1, body: 'version one' })
    render(<CommunitySkillPreview api={api(readVersion)} skill={skill} />)
    fireEvent.change(screen.getByLabelText('Version to preview'), { target: { value: '1' } })
    await screen.findByText('version one')
    await act(async () => resolveOld({ ...skill, body: 'stale version two' }))
    expect(screen.queryByText('stale version two')).toBeNull()
    expect(screen.getByText('version one')).toBeTruthy()
  })

  it('does not read invalid, negative or future versions', async () => {
    const readVersion = vi.fn().mockResolvedValue({ ...skill, body: 'instructions' })
    render(<CommunitySkillPreview api={api(readVersion)} skill={skill} />)
    await waitFor(() => expect(readVersion).toHaveBeenCalledOnce())
    for (const value of ['0', '-1', '1.5', '3', '']) {
      fireEvent.change(screen.getByLabelText('Version to preview'), { target: { value } })
      expect(screen.getByRole('alert')).toBeTruthy()
    }
    expect(readVersion).toHaveBeenCalledOnce()
  })
})

describe('Community Markdown file bounds', () => {
  it('counts bytes instead of characters for multibyte uploads', async () => {
    await expect(
      readCommunitySkillMarkdown(new File(['가'.repeat(22000)], 'SKILL.md'))
    ).rejects.toThrow('64 KiB')
  })
  it('rejects malformed UTF-8 and binary text', async () => {
    await expect(
      readCommunitySkillMarkdown(new File([new Uint8Array([255, 254, 255])], 'SKILL.md'))
    ).rejects.toThrow('UTF-8')
    await expect(readCommunitySkillMarkdown(new File(['text\0text'], 'SKILL.md'))).rejects.toThrow(
      'non-empty Markdown'
    )
  })
  it('rejects empty and non-Markdown files', async () => {
    await expect(readCommunitySkillMarkdown(new File([''], 'SKILL.md'))).rejects.toThrow('64 KiB')
    await expect(readCommunitySkillMarkdown(new File(['instructions'], 'run.sh'))).rejects.toThrow(
      'Markdown'
    )
    await expect(readCommunitySkillMarkdown(new File(['   '], 'SKILL.md'))).rejects.toThrow(
      'non-empty Markdown'
    )
  })
  it('accepts the exact byte limit as text without executing HTML', async () => {
    const body = `<script>alert(1)</script>${'x'.repeat(65511)}`
    expect(new TextEncoder().encode(body).byteLength).toBe(65536)
    await expect(readCommunitySkillMarkdown(new File([body], 'SKILL.md'))).resolves.toBe(body)
    expect(document.querySelector('script')).toBeNull()
  })
})
