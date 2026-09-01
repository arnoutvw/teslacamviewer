import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import LinearProgress from '@mui/material/LinearProgress'
import LoginIcon from '@mui/icons-material/Login'
import { fetchKeys, getValidAccessToken, type EventDetailDto, type KeyItemDto } from '../api/client'
import TeslaLoginDialog from './TeslaLoginDialog'
import { useTeslaAuth } from './useTeslaAuth'

type Phase = 'ok' | 'checking' | 'fetching' | 'partial' | 'login' | 'error'

/**
 * Blocks playback behind the key fetch for encrypted events: dedupes the
 * segments' key items, makes sure the user has a valid Tesla token, fetches
 * the keys, and only then renders the player. Unencrypted events fall
 * straight through. The hook instance lives here (Player has no Tesla chip
 * of its own), so dialog login state does not need to be lifted anywhere.
 */
export default function EncryptionGate({ detail, children }: { detail: EventDetailDto; children: ReactNode }) {
  const auth = useTeslaAuth()
  const [loginOpen, setLoginOpen] = useState(false)

  // Distinct store keys across all cameras, in encounter order.
  const keyItems = useMemo<KeyItemDto[]>(() => {
    const seen = new Set<string>()
    const out: KeyItemDto[] = []
    for (const segments of Object.values(detail.segmentsByCamera)) {
      for (const s of segments) {
        const k = s.keyItem
        if (!s.encrypted || k == null) continue
        const id = `${k.vin}:${k.keyId}:${k.timestamp}`
        if (!seen.has(id)) {
          seen.add(id)
          out.push(k)
        }
      }
    }
    return out
  }, [detail])

  const [phase, setPhase] = useState<Phase>(() => (keyItems.length === 0 ? 'ok' : 'checking'))
  const [noKeyCount, setNoKeyCount] = useState(0)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (keyItems.length === 0) return
    let cancelled = false
    setPhase('fetching')
    setErrorText(null)
    getValidAccessToken()
      .then((token) => {
        // No stored token, or refresh failed → step 1: the login prompt.
        // fetchKeys re-checks the token and throws not_logged_in itself if it
        // expires in between, which the catch below maps to the same state.
        if (cancelled) return null
        if (token == null) {
          setPhase('login')
          return null
        }
        return fetchKeys(keyItems)
      })
      .then((res) => {
        if (cancelled || res == null) return
        const missing = res.results.filter((r) => r.status !== 'fetched').length
        setNoKeyCount(missing)
        setPhase(missing > 0 ? 'partial' : 'ok')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Expired/missing token mid-flow behaves like the no-token case.
        if (err instanceof Error && err.message === 'not_logged_in') {
          setPhase('login')
          return
        }
        setErrorText(err instanceof Error ? err.message : 'Key fetch failed')
        setPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [keyItems, auth.loggedIn, retryTick])

  if (phase === 'ok' && noKeyCount === 0) return <>{children}</>

  if (phase === 'ok' || phase === 'partial') {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Alert severity="warning" sx={{ m: 1 }}>
          {noKeyCount} clip{noKeyCount === 1 ? '' : 's'} could not be decrypted — Tesla
          returned no key for them
        </Alert>
        <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
      </Box>
    )
  }

  if (phase === 'fetching' || phase === 'checking') {
    return (
      <Box sx={{ p: 3 }}>
        <LinearProgress />
      </Box>
    )
  }

  if (phase === 'login') {
    return (
      <Box sx={{ p: 3 }}>
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" startIcon={<LoginIcon />} onClick={() => setLoginOpen(true)}>
              Log in with Tesla
            </Button>
          }
        >
          This event contains encrypted clips. Log in with your Tesla account to fetch
          the decryption keys.
        </Alert>
        <TeslaLoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} auth={auth} />
      </Box>
    )
  }

  // error
  const blocked = errorText != null && errorText.includes('403')
  return (
    <Box sx={{ p: 3 }}>
      <Alert
        severity="error"
        action={
          <Button color="inherit" size="small" onClick={() => setRetryTick((t) => t + 1)}>
            Retry
          </Button>
        }
      >
        {blocked
          ? 'The server-side key fetch was blocked by Tesla (HTTP 403 — Akamai). Please retry later.'
          : errorText}
      </Alert>
    </Box>
  )
}