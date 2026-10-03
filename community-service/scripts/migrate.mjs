import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const settingsPath = process.argv[2]
let url = process.env.DATABASE_URL
if (!url && settingsPath) {
  const line = readFileSync(settingsPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => value.trim().startsWith('DATABASE_URL='))
  url = line
    ?.slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^['"]|['"]$/g, '')
}
if (!url) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}
try {
  const sql = neon(url)
  const text = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
  const statements = text
    .split(/;\s*\n(?=(?:CREATE|DROP|REVOKE|INSERT)\b)/)
    .map((s) => s.trim())
    .filter(Boolean)
  await sql.transaction(statements.map((statement) => sql.query(statement)))
  console.log(JSON.stringify({ migrated: true, statements: statements.length }))
} catch (error) {
  console.error(
    JSON.stringify({ migrated: false, errorName: error.name, errorCode: error.code ?? null })
  )
  process.exitCode = 1
}
