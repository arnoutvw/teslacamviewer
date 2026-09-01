import { useCallback, useState } from 'react'
import { completeLogin, startLogin } from './teslaAuth'
import { clearTokens, loadTokens } from '../api/client'

export interface TeslaAuthState {
  loggedIn: boolean
  busy: boolean
  error: string | null
  /** Resolves true when the login window was opened, false on failure. */
  start(): Promise<boolean>
  /** Resolves true when the code exchange succeeded, false on failure. */
  confirm(pastedUrl: string): Promise<boolean>
  logout(): void
}

function errorMessage(err: unknown): string {
  // Never surface token values: auth errors are plain messages from
  // teslaAuth/client, and unknown values are stringified without contents.
  if (err instanceof Error) return err.message
  return 'Login failed — please try again'
}

export function useTeslaAuth(): TeslaAuthState {
  const [loggedIn, setLoggedIn] = useState<boolean>(() => loadTokens() != null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async (): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await startLogin()
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const confirm = useCallback(async (pastedUrl: string): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await completeLogin(pastedUrl)
      setLoggedIn(loadTokens() != null)
      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const logout = useCallback((): void => {
    clearTokens()
    setLoggedIn(false)
    setError(null)
  }, [])

  return { loggedIn, busy, error, start, confirm, logout }
}