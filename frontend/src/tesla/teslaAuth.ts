import { exchangeCode, saveTokens } from '../api/client'

export const AUTHORIZE_URL = 'https://auth.tesla.com/oauth2/v3/authorize'
export const CLIENT_ID = 'dashcam'
export const REDIRECT_URI = 'https://dashcam.tesla.com/callback'
export const SCOPES = 'openid profile email offline_access'

const PKCE_KEY = 'tesla.pkce'

export interface PkcePending {
  verifier: string
  state: string
}

export function buildAuthorizeUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

export function parseCallbackUrl(url: string): { code: string; state: string } | null {
  try {
    const u = new URL(url.trim())
    const code = u.searchParams.get('code')
    if (code == null || code === '') return null
    return { code, state: u.searchParams.get('state') ?? '' }
  } catch {
    return null
  }
}

export async function startLogin(): Promise<void> {
  const res = await fetch('/api/tesla/pkce')
  if (!res.ok) throw new Error(`pkce mint failed: HTTP ${res.status}`)
  const pkce = (await res.json()) as { verifier: string; challenge: string; state: string }
  localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier: pkce.verifier, state: pkce.state }))
  window.open(buildAuthorizeUrl(pkce.challenge, pkce.state), '_blank')
}

export function takePkce(): { verifier: string; state: string } | null {
  try {
    const raw = localStorage.getItem(PKCE_KEY)
    if (raw == null) return null
    localStorage.removeItem(PKCE_KEY)
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function completeLogin(pastedUrl: string): Promise<void> {
  const parsed = parseCallbackUrl(pastedUrl)
  if (parsed == null) return Promise.reject(new Error('No authorization code in pasted URL'))
  const pkce = takePkce()
  if (pkce == null) return Promise.reject(new Error('No pending login — start the login first'))
  if (pkce.state !== parsed.state) return Promise.reject(new Error('State mismatch — paste the URL from the same login attempt'))
  return exchangeCode(parsed.code, pkce.verifier).then((tokens) => {
    saveTokens(tokens)
  })
}