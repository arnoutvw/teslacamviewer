import { afterEach, describe, it, expect, vi } from 'vitest'
import { buildAuthorizeUrl, completeLogin, parseCallbackUrl } from './teslaAuth'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('buildAuthorizeUrl', () => {
  it('includes client_id, redirect_uri, S256 challenge and state', () => {
    const url = buildAuthorizeUrl('challenge123', 'state456')
    expect(url.startsWith('https://auth.tesla.com/oauth2/v3/authorize?')).toBe(true)
    expect(url).toContain('client_id=dashcam')
    expect(url).toContain('redirect_uri=https%3A%2F%2Fdashcam.tesla.com%2Fcallback')
    expect(url).toContain('code_challenge=challenge123')
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain('state=state456')
    expect(url).toContain('scope=openid')
  })
})

describe('parseCallbackUrl', () => {
  it('extracts code and state', () => {
    const out = parseCallbackUrl('https://dashcam.tesla.com/callback?code=abc&state=xyz')
    expect(out).toEqual({ code: 'abc', state: 'xyz' })
  })
  it('returns null when code missing', () => {
    expect(parseCallbackUrl('https://dashcam.tesla.com/callback?state=xyz')).toBeNull()
  })
  it('returns null for garbage input', () => {
    expect(parseCallbackUrl('not a url')).toBeNull()
  })
})

describe('completeLogin', () => {
  it('persists exchanged tokens under tesla.tokens', async () => {
    const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: 999 }
    localStorage.setItem('tesla.pkce', JSON.stringify({ verifier: 'verifier1', state: 'xyz' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(tokens), { status: 200 })))

    await completeLogin('https://dashcam.tesla.com/callback?code=abc&state=xyz')

    expect(JSON.parse(localStorage.getItem('tesla.tokens')!)).toEqual(tokens)
    expect(JSON.parse(localStorage.getItem('tesla.pkce') ?? 'null')).toBeNull()
  })
})