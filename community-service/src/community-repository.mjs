import { randomUUID } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { digestBody, ServiceError } from './skill-validation.mjs'

const metadataColumns = `s.id,u.username AS author,v.name,v.description,v.version,v.digest,
 v.supported_agents AS "supportedAgents",v.created_at AS "updatedAt"`
const metadataJoin = `community.skills s JOIN community.users u ON u.id=s.owner_id
 JOIN community.versions v ON v.skill_id=s.id`

export function createRepository(connectionString) {
  const sql = neon(connectionString, { fetchOptions: { signal: undefined } })
  const query = (text, params = []) =>
    sql.query(text, params, { fetchOptions: { signal: AbortSignal.timeout(10000) } })
  return {
    async limit(key, windowStart, maximum) {
      const rows = await query(
        `INSERT INTO community.rate_limits(key,window_start,count) VALUES($1,$2,1)
        ON CONFLICT(key) DO UPDATE SET window_start=GREATEST(community.rate_limits.window_start,EXCLUDED.window_start),
        count=CASE WHEN community.rate_limits.window_start>=EXCLUDED.window_start
        THEN community.rate_limits.count+1 ELSE 1 END RETURNING count`,
        [key, windowStart]
      )
      if (rows[0].count > maximum) {
        throw new ServiceError(429, 'Too many requests. Try again later.')
      }
    },
    async cleanup() {
      await query('DELETE FROM community.rate_limits WHERE window_start < $1', [
        Math.floor(Date.now() / 60000) - 1440
      ])
      await query('DELETE FROM community.sessions WHERE expires_at < now()')
    },
    async findUser(username) {
      return (
        await query('SELECT id,username,password_hash FROM community.users WHERE username=$1', [
          username
        ])
      )[0]
    },
    async register(username, passwordHash) {
      try {
        const rows = await query('SELECT * FROM community.register_user($1,$2,$3)', [
          randomUUID(),
          username,
          passwordHash
        ])
        return rows[0]
      } catch (error) {
        if (error.code === '23505') {
          throw new ServiceError(409, 'Username unavailable.')
        }
        if (error.code === 'P0001') {
          throw new ServiceError(429, 'Account capacity reached.')
        }
        throw error
      }
    },
    async createSession(userId, hash) {
      try {
        await query('SELECT community.create_session($1,$2)', [userId, hash])
      } catch (error) {
        if (error.code === 'P0001') {
          throw new ServiceError(
            429,
            'Session limit reached. Sign out unused sessions or wait for expiration.'
          )
        }
        throw error
      }
    },
    async session(hash) {
      return (
        await query(
          `SELECT u.id,u.username FROM community.sessions t JOIN community.users u
        ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>now()`,
          [hash]
        )
      )[0]
    },
    async logout(hash) {
      await query('DELETE FROM community.sessions WHERE token_hash=$1', [hash])
    },
    async search(term, offset) {
      const rows = await query(
        `SELECT ${metadataColumns} FROM ${metadataJoin}
        WHERE s.visible AND v.version=s.latest_version AND
        (strpos(lower(v.name),lower($1))>0 OR strpos(lower(v.description),lower($1))>0
         OR strpos(lower(u.username),lower($1))>0)
        ORDER BY v.created_at DESC,s.id LIMIT 21 OFFSET $2`,
        [term, offset]
      )
      return { items: rows.slice(0, 20), hasMore: rows.length > 20 }
    },
    async readVersion(id, version) {
      const row = (
        await query(
          `SELECT ${metadataColumns},v.body FROM ${metadataJoin}
        WHERE s.visible AND s.id=$1 AND v.version=$2`,
          [id, version]
        )
      )[0]
      if (!row) {
        throw new ServiceError(404, 'Skill version unavailable.')
      }
      return row
    },
    async publish(userId, input) {
      try {
        const rows = await query(
          `SELECT skill_id AS id,published_version AS version,name,description,digest,
          supported_agents AS "supportedAgents",created_at AS "updatedAt"
          FROM community.publish_skill($1,$2,$3,$4,$5,$6,$7)`,
          [
            userId,
            input.skillId ?? null,
            input.name,
            input.description,
            input.body,
            digestBody(input.body),
            input.supportedAgents
          ]
        )
        return rows[0]
      } catch (error) {
        if (error.code === 'P0001') {
          throw new ServiceError(429, 'Publishing storage or version limit reached.')
        }
        if (error.code === 'P0002') {
          throw new ServiceError(404, 'Skill unavailable.')
        }
        throw error
      }
    },
    async hide(userId, id) {
      const rows = await query(
        'UPDATE community.skills SET visible=false WHERE id=$1 AND owner_id=$2 RETURNING id',
        [id, userId]
      )
      if (!rows[0]) {
        throw new ServiceError(404, 'Skill unavailable.')
      }
    },
    async report(userId, id, reason) {
      try {
        await query('SELECT community.report_skill($1,$2,$3)', [userId, id, reason])
      } catch (error) {
        if (error.code === 'P0001') {
          throw new ServiceError(429, 'Report storage limit reached.')
        }
        if (error.code === 'P0002') {
          throw new ServiceError(404, 'Skill unavailable.')
        }
        throw error
      }
    }
  }
}
