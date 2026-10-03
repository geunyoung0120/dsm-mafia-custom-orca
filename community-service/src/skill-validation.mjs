import { createHash } from 'node:crypto'

export class ServiceError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
export const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const providers = ['codex', 'claude', 'openclaude', 'grok']
export function validateCredentials(value) {
  if (
    !value ||
    typeof value.username !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{2,31}$/.test(value.username) ||
    typeof value.password !== 'string' ||
    value.password.length < 12 ||
    value.password.length > 256
  ) {
    throw new ServiceError(
      400,
      'Use a lowercase username (3–32 characters) and a password of 12–256 characters.'
    )
  }
  return { username: value.username, password: value.password }
}
export function validatePublish(value) {
  if (
    !value ||
    typeof value.name !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.name) ||
    typeof value.description !== 'string' ||
    value.description.length > 500 ||
    typeof value.body !== 'string' ||
    !value.body.trim() ||
    Buffer.byteLength(value.body) > 65536 ||
    !Array.isArray(value.supportedAgents) ||
    value.supportedAgents.length < 1 ||
    value.supportedAgents.length > 4 ||
    new Set(value.supportedAgents).size !== value.supportedAgents.length ||
    value.supportedAgents.some((agent) => !providers.includes(agent)) ||
    (value.skillId !== undefined && !uuidPattern.test(value.skillId))
  ) {
    throw new ServiceError(
      400,
      'Invalid skill. Use a slug name, description up to 500 characters, and Markdown up to 64 KiB.'
    )
  }
  const frontmatter = value.body.match(/^---\s*\n([\s\S]*?)\n---(?:\s|$)/)?.[1] ?? ''
  if (
    /^(?:dependencies|requires|scripts|assets|references):/im.test(frontmatter) ||
    /\]\((?!https?:|mailto:|#)(?:[^)]*\/|[^)]*\.(?:md|py|sh|js|ts|json|yaml|yml))[^)]*\)/i.test(
      value.body
    )
  ) {
    throw new ServiceError(
      400,
      'This catalog supports standalone Markdown instructions only. Remove companion-file dependencies.'
    )
  }
  return {
    ...(value.skillId ? { skillId: value.skillId } : {}),
    name: value.name,
    description: value.description,
    body: value.body,
    supportedAgents: value.supportedAgents
  }
}
export const digestBody = (body) => createHash('sha256').update(body, 'utf8').digest('hex')
export function parseSkillRoute(path) {
  const match = path.match(/^\/skills\/([^/]+)\/versions\/([1-9][0-9]{0,8})$/)
  return match && uuidPattern.test(match[1]) ? { id: match[1], version: Number(match[2]) } : null
}
