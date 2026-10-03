import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = await derive(password, salt, 64, options)
  return `scrypt:${salt}:${hash.toString('hex')}`
}
export async function verifyPassword(password, encoded) {
  const parts = encoded?.split(':') ?? []
  const valid =
    parts.length === 3 &&
    parts[0] === 'scrypt' &&
    /^[a-f0-9]{32}$/.test(parts[1]) &&
    /^[a-f0-9]{128}$/.test(parts[2])
  const salt = valid ? parts[1] : '0'.repeat(32)
  const expected = Buffer.from(valid ? parts[2] : '0'.repeat(128), 'hex')
  const actual = await derive(password, salt, 64, options)
  return valid && timingSafeEqual(actual, expected)
}
export const newSessionToken = () => randomBytes(32).toString('base64url')
export const hashSessionToken = (token) => createHash('sha256').update(token).digest('hex')
