import { readFileSync } from 'node:fs'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function readRecord(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}
