import { COMMUNITY_SKILL_BODY_MAX_BYTES } from '../../../../shared/community-skills'
import { translate } from '@/i18n/i18n'

export async function readCommunitySkillMarkdown(file: File): Promise<string> {
  if (
    !/\.(md|markdown)$/i.test(file.name) ||
    file.size === 0 ||
    file.size > COMMUNITY_SKILL_BODY_MAX_BYTES
  ) {
    throw new Error(
      translate('communitySkills.fileLimit', 'Choose a Markdown file of at most 64 KiB.')
    )
  }
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result)
      } else {
        reject(
          new Error(
            translate('communitySkills.fileReadFailed', 'Could not read this Markdown file.')
          )
        )
      }
    }
    reader.onerror = () =>
      reject(
        new Error(translate('communitySkills.fileReadFailed', 'Could not read this Markdown file.'))
      )
    reader.onabort = () =>
      reject(
        new Error(translate('communitySkills.fileReadFailed', 'Could not read this Markdown file.'))
      )
    reader.readAsArrayBuffer(file)
  })
  let body: string
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(translate('communitySkills.fileUtf8', 'Choose a valid UTF-8 Markdown file.'))
  }
  if (
    !body.trim() ||
    body.includes('\0') ||
    new TextEncoder().encode(body).byteLength > COMMUNITY_SKILL_BODY_MAX_BYTES
  ) {
    throw new Error(
      translate('communitySkills.fileContent', 'Choose non-empty Markdown text of at most 64 KiB.')
    )
  }
  return body
}
