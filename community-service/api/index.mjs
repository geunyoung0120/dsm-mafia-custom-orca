import { createRepository } from '../src/community-repository.mjs'
import { createHandler } from '../src/community-http.mjs'

let handler
export default async function route(req, res) {
  if (!process.env.DATABASE_URL || !process.env.RATE_LIMIT_SECRET) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Service unavailable.' }))
    return
  }
  handler ??= createHandler(
    createRepository(process.env.DATABASE_URL),
    process.env.RATE_LIMIT_SECRET
  )
  return handler(req, res)
}
