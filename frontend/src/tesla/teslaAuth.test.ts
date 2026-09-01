import { describe, it, expect } from 'vitest'
import { buildAuthorizeUrl, parseCallbackUrl } from './teslaAuth'

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