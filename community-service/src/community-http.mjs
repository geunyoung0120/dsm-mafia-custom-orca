import { createHmac } from 'node:crypto'
import {
  validateCredentials,
  validatePublish,
  parseSkillRoute,
  uuidPattern,
  ServiceError
} from './skill-validation.mjs'
import {
  hashPassword,
  verifyPassword,
  newSessionToken,
  hashSessionToken
} from './password-sessions.mjs'

function bearer(headers) {
  const value = headers.authorization
  return typeof value === 'string' && /^Bearer [A-Za-z0-9_-]{43}$/.test(value)
    ? value.slice(7)
    : null
}
async function readJson(req) {
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new ServiceError(415, 'Send JSON with Content-Type: application/json.')
  }
  if (req.body !== undefined) {
    const serialized = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    if (Buffer.byteLength(serialized) > 131072) {
      throw new ServiceError(413, 'Request too large.')
    }
    try {
      return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    } catch {
      throw new ServiceError(400, 'Invalid JSON.')
    }
  }
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 131072) {
      throw new ServiceError(413, 'Request too large.')
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ServiceError(400, 'Invalid JSON.')
  }
}
function respond(res, status, value) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  if (status === 429) {
    res.setHeader('Retry-After', '60')
  }
  res.statusCode = status
  res.end(JSON.stringify(value))
}
export function createHandler(repository, rateSecret) {
  return async function handle(req, res) {
    try {
      const path = new URL(req.url, 'https://service.invalid').pathname
      const method = req.method
      if ((path === '/' || path === '/health') && method === 'GET') {
        return respond(res, 200, { service: 'dsm-mafia-community-skills', version: 1 })
      }
      const minute = Math.floor(Date.now() / 60000)
      const rawIp = (req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown')
        .split(',')[0]
        .trim()
      const ipHash = createHmac('sha256', rateSecret).update(rawIp).digest('hex')
      await repository.limit(`traffic:${ipHash}`, minute, 120)
      if (Math.random() < 0.01) {
        await repository.cleanup()
      }
      if (method === 'POST' && (path === '/auth/register' || path === '/auth/login')) {
        await repository.limit(`auth:${ipHash}`, minute, 6)
        const input = validateCredentials(await readJson(req))
        const handleHash = createHmac('sha256', rateSecret).update(input.username).digest('hex')
        await repository.limit(`account-auth:${handleHash}`, minute - (minute % 5), 10)
        let user
        if (path === '/auth/register') {
          user = await repository.register(input.username, await hashPassword(input.password))
        } else {
          user = await repository.findUser(input.username)
          if (!(await verifyPassword(input.password, user?.password_hash))) {
            throw new ServiceError(401, 'Invalid username or password.')
          }
        }
        const token = newSessionToken()
        await repository.createSession(user.id, hashSessionToken(token))
        return respond(res, 200, { token, author: user.username })
      }
      if (method === 'GET' && path === '/skills') {
        const params = new URL(req.url, 'https://service.invalid').searchParams
        const term = params.get('query') ?? ''
        const rawOffset = params.get('offset') ?? '0'
        if (term.length > 100 || !/^\d{1,5}$/.test(rawOffset) || Number(rawOffset) > 10000) {
          throw new ServiceError(400, 'Invalid search query or offset.')
        }
        return respond(res, 200, await repository.search(term, Number(rawOffset)))
      }
      const version = parseSkillRoute(path)
      if (method === 'GET' && version) {
        return respond(res, 200, await repository.readVersion(version.id, version.version))
      }
      const token = bearer(req.headers)
      const user = token ? await repository.session(hashSessionToken(token)) : null
      if (!user) {
        throw new ServiceError(401, 'Sign in to publish or manage skills.')
      }
      if (method === 'POST' && path === '/auth/logout') {
        await repository.logout(hashSessionToken(token))
        return respond(res, 200, { ok: true })
      }
      if (method === 'POST' && path === '/skills') {
        await repository.limit(`publish:${user.id}`, minute, 10)
        const result = await repository.publish(user.id, validatePublish(await readJson(req)))
        return respond(res, 200, { ...result, author: user.username })
      }
      const hide = path.match(/^\/skills\/([^/]+)\/hide$/)
      const report = path.match(/^\/skills\/([^/]+)\/report$/)
      if (method === 'POST' && hide && uuidPattern.test(hide[1])) {
        await repository.hide(user.id, hide[1])
        return respond(res, 200, { ok: true })
      }
      if (method === 'POST' && report && uuidPattern.test(report[1])) {
        await repository.limit(`report:${user.id}`, minute, 5)
        const input = await readJson(req)
        if (
          typeof input?.reason !== 'string' ||
          !input.reason.trim() ||
          input.reason.length > 1000
        ) {
          throw new ServiceError(400, 'Provide a report reason of 1–1000 characters.')
        }
        await repository.report(user.id, report[1], input.reason)
        return respond(res, 200, { ok: true })
      }
      throw new ServiceError(404, 'Endpoint unavailable.')
    } catch (error) {
      return respond(res, error instanceof ServiceError ? error.status : 503, {
        error:
          error instanceof ServiceError ? error.message : 'Service unavailable. Try again later.'
      })
    }
  }
}
