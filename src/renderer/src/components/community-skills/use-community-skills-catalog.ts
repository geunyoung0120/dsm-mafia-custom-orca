import { useEffect, useState } from 'react'
import type {
  CommunitySkillsApi,
  CommunitySkillsStatus,
  CommunitySkillSearchResult
} from '../../../../shared/community-skills'

export function useCommunitySkillsCatalog(api: CommunitySkillsApi | undefined) {
  const [status, setStatus] = useState<CommunitySkillsStatus | null>(null)
  const [statusFailed, setStatusFailed] = useState(false)
  const [statusAttempt, setStatusAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<CommunitySkillSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const [searchAttempt, setSearchAttempt] = useState(0)
  useEffect(() => {
    if (!api) {
      return
    }
    let current = true
    setStatusFailed(false)
    setStatus(null)
    void api
      .status()
      .then((value) => {
        if (current) {
          setStatus(value)
        }
      })
      .catch(() => {
        if (current) {
          setStatusFailed(true)
        }
      })
    return () => {
      current = false
    }
  }, [api, statusAttempt])

  const configured = status?.configured === true
  useEffect(() => {
    if (!api || !configured) {
      return
    }
    let current = true
    setLoading(true)
    setSearchFailed(false)
    setResult(null)
    const timer = setTimeout(() => {
      void api
        .search({ query, offset })
        .then((value) => {
          if (current) {
            setResult(value)
          }
        })
        .catch(() => {
          if (current) {
            setSearchFailed(true)
          }
        })
        .finally(() => {
          if (current) {
            setLoading(false)
          }
        })
    }, 250)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [api, configured, query, offset, searchAttempt])

  return {
    status,
    setStatus,
    statusFailed,
    retryStatus: () => setStatusAttempt((value) => value + 1),
    query,
    offset,
    setOffset,
    result,
    loading,
    searchFailed,
    search: (value: string) => {
      setQuery(value)
      setOffset(0)
    },
    refresh: () => setSearchAttempt((value) => value + 1)
  }
}
